const { Redis } = require("@upstash/redis");
const redis = Redis.fromEnv();

const RETENTION_SECONDS = 60 * 60 * 24 * 90;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  const { mspKey, tenant } = req.body || {};
  if (!mspKey || !tenant) {
    res.status(400).json({ error: "mspKey and tenant are required" });
    return;
  }

  try {
    const listRaw = await redis.get(`msp:${mspKey}`);
    let list = listRaw ? JSON.parse(listRaw) : [];
    const next = list.filter((t) => t.tenantId !== tenant);

    if (next.length === 0) {
      await redis.del(`msp:${mspKey}`);
    } else {
      await redis.set(`msp:${mspKey}`, JSON.stringify(next), { ex: RETENTION_SECONDS });
    }

    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Could not remove this tenant from the dashboard." });
  }
};
