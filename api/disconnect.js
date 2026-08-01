const { Redis } = require("@upstash/redis");
const redis = Redis.fromEnv();

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  const { tenant, token: accessToken } = req.body || {};
  if (!tenant || !accessToken) {
    res.status(400).json({ error: "tenant and token are required" });
    return;
  }

  try {
    const raw = await redis.get(`tenant:${tenant}`);
    const stored = raw ? JSON.parse(raw) : null;
    if (!stored || stored.accessToken !== accessToken) {
      res.status(403).json({ error: "Invalid access token." });
      return;
    }
    await redis.del(`tenant:${tenant}`);
    await redis.del(`scan:${tenant}`);
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Could not delete data. Please try again." });
  }
};
