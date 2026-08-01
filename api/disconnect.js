const { Redis } = require("@upstash/redis");
const { parseJson } = require("../lib/redisJson");
const { safeCompare, isValidTenantId, isBoundedString } = require("../lib/security");
const redis = Redis.fromEnv();

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed", code: "METHOD_NOT_ALLOWED" });
    return;
  }
  const { tenant, token: accessToken } = req.body || {};
  if (!isBoundedString(tenant, 100) || !isBoundedString(accessToken, 200)) {
    res.status(400).json({ error: "tenant and token are required", code: "MISSING_PARAMS" });
    return;
  }
  if (!isValidTenantId(tenant)) {
    res.status(400).json({ error: "Malformed tenant identifier.", code: "INVALID_TENANT_ID" });
    return;
  }

  try {
    const raw = await redis.get(`tenant:${tenant}`);
    const stored = parseJson(raw);
    if (!stored || !safeCompare(stored.accessToken, accessToken)) {
      res.status(403).json({ error: "Invalid access token.", code: "INVALID_ACCESS_TOKEN" });
      return;
    }
    await redis.del(`tenant:${tenant}`);
    await redis.del(`scan:${tenant}`);
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Could not delete data. Please try again.", code: "DISCONNECT_FAILED" });
  }
};
