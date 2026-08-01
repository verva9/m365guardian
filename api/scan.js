const { Redis } = require("@upstash/redis");
const { performScan } = require("../lib/runScan");

const redis = Redis.fromEnv();

// Rate limiting: a scan hits several Graph endpoints and (on large tenants)
// pages through thousands of users, so it's the most expensive route in the
// app. Two independent limits protect it:
//   - per-tenant: stops accidental rapid re-scan loops (e.g. a broken retry)
//   - per-IP: stops one caller from hammering many tenant IDs
const TENANT_COOLDOWN_SECONDS = 60; // 1 scan per tenant per minute
const IP_LIMIT = 20; // max scans per IP per window
const IP_WINDOW_SECONDS = 60 * 60; // 1 hour

async function checkRateLimit(key, limit, windowSeconds) {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }
  return count <= limit;
}

function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

module.exports = async (req, res) => {
  const { tenant, token: accessToken } = req.query;
  if (!tenant || !accessToken) {
    res.status(400).json({ error: "tenant and token query params are required." });
    return;
  }

  // Verify this request actually holds the private access token issued when
  // the tenant admin granted consent - the tenant GUID alone isn't enough.
  let stored;
  try {
    const raw = await redis.get(`tenant:${tenant}`);
    stored = raw ? JSON.parse(raw) : null;
  } catch (e) {
    stored = null;
  }
  if (!stored || stored.accessToken !== accessToken) {
    res.status(403).json({ error: "Invalid or expired access token for this tenant. Reconnect to get a new link." });
    return;
  }

  // Rate limits (fail open on Redis errors so an outage doesn't block scans).
  try {
    const ip = getClientIp(req);
    const [tenantOk, ipOk] = await Promise.all([
      checkRateLimit(`ratelimit:tenant:${tenant}`, 1, TENANT_COOLDOWN_SECONDS),
      checkRateLimit(`ratelimit:ip:${ip}`, IP_LIMIT, IP_WINDOW_SECONDS),
    ]);
    if (!tenantOk) {
      res.status(429).json({ error: `Please wait a moment before re-scanning this tenant again (limit: 1 per ${TENANT_COOLDOWN_SECONDS}s).` });
      return;
    }
    if (!ipOk) {
      res.status(429).json({ error: "Too many scan requests from your network. Please try again later." });
      return;
    }
  } catch (e) {
    // Redis unavailable - allow the scan through rather than hard-fail the product.
  }

  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    res.status(500).json({ error: "Server is missing AZURE_CLIENT_ID / AZURE_CLIENT_SECRET env vars." });
    return;
  }

  try {
    const report = await performScan(tenant, clientId, clientSecret);
    res.status(200).json(report);
  } catch (e) {
    res.status(500).json({
      error: "Scan failed. This usually means admin consent hasn't been granted yet, or the app registration is missing a required permission.",
      detail: String(e.message || e),
    });
  }
};

