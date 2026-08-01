const { Redis } = require("@upstash/redis");
const { parseJson } = require("../lib/redisJson");
const { isValidTenantId, isBoundedString } = require("../lib/security");
const redis = Redis.fromEnv();

const RETENTION_SECONDS = 60 * 60 * 24 * 90;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed", code: "METHOD_NOT_ALLOWED" });
    return;
  }
  const { mspKey, tenant } = req.body || {};
  if (!isBoundedString(mspKey, 128) || !isBoundedString(tenant, 100)) {
    res.status(400).json({ error: "mspKey and tenant are required", code: "MISSING_PARAMS" });
    return;
  }
  if (!isValidTenantId(tenant)) {
    res.status(400).json({ error: "Malformed tenant identifier.", code: "INVALID_TENANT_ID" });
    return;
  }

  try {
    const listRaw = await redis.get(`msp:${mspKey}`);
    let list = parseJson(listRaw) || [];
    const next = list.filter((t) => t.tenantId !== tenant);

    if (next.length === 0) {
      await redis.del(`msp:${mspKey}`);
    } else {
      await redis.set(`msp:${mspKey}`, JSON.stringify(next), { ex: RETENTION_SECONDS });
    }

    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Could not remove this tenant from the dashboard.", code: "MSP_UNLINK_FAILED" });
  }
};
