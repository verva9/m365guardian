const { Redis } = require("@upstash/redis");
const { parseJson } = require("../lib/redisJson");
const { safeCompare, isValidTenantId, isBoundedString } = require("../lib/security");
const redis = Redis.fromEnv();

// Returns the last several scan scores for a tenant (oldest -> newest) so
// the report page can render a simple trend line. Auth follows the same
// private-access-token model as scan.js - the tenant GUID alone isn't enough.
module.exports = async (req, res) => {
  const { tenant, token: accessToken } = req.query;
  if (!isBoundedString(tenant, 100) || !isBoundedString(accessToken, 200)) {
    res.status(400).json({ error: "tenant and token query params are required.", code: "MISSING_PARAMS" });
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
      res.status(403).json({ error: "Invalid or expired access token for this tenant.", code: "INVALID_ACCESS_TOKEN" });
      return;
    }

    const entries = await redis.lrange(`scan-history:${tenant}`, 0, -1);
    const history = (entries || [])
      .map((e) => parseJson(e))
      .reverse(); // stored newest-first (lpush), return oldest-first for charting

    res.status(200).json({ history });
  } catch (e) {
    res.status(500).json({ error: "Could not load scan history.", code: "HISTORY_LOAD_FAILED" });
  }
};
