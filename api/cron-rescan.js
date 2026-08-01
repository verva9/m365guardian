const { Redis } = require("@upstash/redis");
const { performScan } = require("../lib/runScan");
const { parseJson } = require("../lib/redisJson");
const { safeCompare } = require("../lib/security");

const redis = Redis.fromEnv();

// Weekly retention feature: re-scans every tenant linked to a Pro dashboard
// so an MSP opens their dashboard to fresh data instead of a stale scan from
// whenever they last clicked "Re-scan now". Triggered by Vercel Cron (see
// vercel.json) - NOT reachable usefully by end users since it doesn't accept
// or need a tenant/token pair, only the shared CRON_SECRET.
//
// Capped at MAX_TENANTS_PER_RUN per invocation to stay within serverless
// execution limits. If you have more Pro tenants than that, this needs to
// move to a queue (e.g. QStash, which Upstash also offers) instead of one
// big synchronous loop.
const MAX_TENANTS_PER_RUN = 40;

module.exports = async (req, res) => {
  // SECURITY: CRON_SECRET is required, not optional. Previously this route
  // skipped auth entirely if CRON_SECRET wasn't set, meaning anyone who
  // discovered the URL could trigger scans of every Pro customer's tenant on
  // demand. Fail closed instead: no secret configured means this route
  // refuses to run at all, rather than silently running unauthenticated.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    res.status(500).json({ error: "Server is missing CRON_SECRET. This route is disabled until it's configured.", code: "CRON_SECRET_MISSING" });
    return;
  }
  const auth = req.headers.authorization || "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!safeCompare(provided, cronSecret)) {
    res.status(401).json({ error: "Unauthorized.", code: "CRON_UNAUTHORIZED" });
    return;
  }

  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    res.status(500).json({ error: "Server is missing AZURE_CLIENT_ID / AZURE_CLIENT_SECRET env vars.", code: "AZURE_CONFIG_MISSING" });
    return;
  }

  const results = { scanned: [], failed: [], skipped: 0 };

  try {
    // Find every Pro dashboard, then every tenant linked to it.
    const proKeys = await redis.keys("msp-pro:*");
    const tenantIds = new Set();

    for (const proKey of proKeys) {
      const proRaw = await redis.get(proKey);
      const pro = parseJson(proRaw);
      if (!pro || !pro.active) continue;

      const mspKey = proKey.replace(/^msp-pro:/, "");
      const listRaw = await redis.get(`msp:${mspKey}`);
      const list = parseJson(listRaw) || [];
      list.forEach((t) => tenantIds.add(t.tenantId));
    }

    const toScan = Array.from(tenantIds).slice(0, MAX_TENANTS_PER_RUN);
    results.skipped = Math.max(0, tenantIds.size - toScan.length);

    for (const tenantId of toScan) {
      try {
        await performScan(tenantId, clientId, clientSecret);
        results.scanned.push(tenantId);
      } catch (e) {
        // One tenant failing (revoked consent, expired secret mid-run, etc.)
        // shouldn't stop the rest of the batch.
        results.failed.push({ tenantId, error: String(e.message || e).slice(0, 200) });
      }
    }

    res.status(200).json(results);
  } catch (e) {
    res.status(500).json({ error: "Cron re-scan run failed.", code: "CRON_RUN_FAILED", detail: String(e.message || e).slice(0, 300), partial: results });
  }
};
