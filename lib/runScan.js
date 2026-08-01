const { Redis } = require("@upstash/redis");
const { getAppToken, graphGet } = require("./graph");
const { runAllChecks } = require("./checks");

const redis = Redis.fromEnv();
const RETENTION_SECONDS = 60 * 60 * 24 * 90;
const HISTORY_MAX_ENTRIES = 10;

// Shared scan-and-persist logic, used by both the interactive api/scan.js
// (rate-limited, requires the caller's private access token) and
// api/cron-rescan.js (server-initiated, no per-request auth needed since
// it's not reachable by end users). Keeping this in one place means the
// score-delta/history bookkeeping can't drift between the two call sites.
async function performScan(tenantId, clientId, clientSecret) {
  const graphToken = await getAppToken(tenantId, clientId, clientSecret);

  let orgName = null;
  try {
    const org = await graphGet(graphToken, "/organization");
    orgName = org?.[0]?.displayName || null;
  } catch (e) {
    // Non-fatal - report still works without the friendly name.
  }

  const report = await runAllChecks(graphToken);
  report.tenantName = orgName;

  try {
    const prevRaw = await redis.get(`scan:${tenantId}`);
    const prev = prevRaw ? JSON.parse(prevRaw) : null;
    if (prev && typeof prev.score === "number" && typeof report.score === "number") {
      report.previousScore = prev.score;
      report.scoreDelta = report.score - prev.score;
    }

    await redis.set(`scan:${tenantId}`, JSON.stringify(report), { ex: RETENTION_SECONDS });

    const historyKey = `scan-history:${tenantId}`;
    await redis.lpush(historyKey, JSON.stringify({ score: report.score, scannedAt: report.scannedAt }));
    await redis.ltrim(historyKey, 0, HISTORY_MAX_ENTRIES - 1);
    await redis.expire(historyKey, RETENTION_SECONDS);
  } catch (e) {
    // Non-fatal - still return the report even if caching fails.
  }

  return report;
}

module.exports = { performScan };
