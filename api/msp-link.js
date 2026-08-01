const { Redis } = require("@upstash/redis");
const crypto = require("crypto");
const { parseJson } = require("../lib/redisJson");
const { safeCompare, isValidTenantId, isBoundedString } = require("../lib/security");
const redis = Redis.fromEnv();

const RETENTION_SECONDS = 60 * 60 * 24 * 90;
const MAX_TENANTS_PER_MSP = 200;
const FREE_TENANT_LIMIT = 1; // beyond this, the dashboard requires the Pro subscription

// Links an already-connected tenant (identified by its own tenant/token pair
// - the same private token issued at connect time) into an "MSP dashboard"
// group, identified by an mspKey. If no mspKey is supplied, a new one is
// generated and returned - the caller is responsible for saving it, the same
// way they'd save any secret credential: whoever holds the mspKey can see
// every tenant linked to it, including a link into each tenant's full report.
module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed", code: "METHOD_NOT_ALLOWED" });
    return;
  }
  const { tenant, token: accessToken, mspKey: providedKey, label } = req.body || {};
  if (!isBoundedString(tenant, 100) || !isBoundedString(accessToken, 200)) {
    res.status(400).json({ error: "tenant and token are required", code: "MISSING_PARAMS" });
    return;
  }
  if (!isValidTenantId(tenant)) {
    res.status(400).json({ error: "Malformed tenant identifier.", code: "INVALID_TENANT_ID" });
    return;
  }
  if (providedKey !== undefined && !isBoundedString(providedKey, 128)) {
    res.status(400).json({ error: "Malformed mspKey.", code: "INVALID_MSP_KEY" });
    return;
  }
  if (label !== undefined && label !== null && !isBoundedString(label, 200)) {
    res.status(400).json({ error: "Label is too long.", code: "INVALID_LABEL" });
    return;
  }

  try {
    // Re-validate the tenant/token pair the same way scan.js does.
    const raw = await redis.get(`tenant:${tenant}`);
    const stored = parseJson(raw);
    if (!stored || !safeCompare(stored.accessToken, accessToken)) {
      res.status(403).json({ error: "Invalid access token for this tenant.", code: "INVALID_ACCESS_TOKEN" });
      return;
    }

    const mspKey = providedKey && providedKey.length >= 16 ? providedKey : crypto.randomBytes(20).toString("hex");

    const listRaw = await redis.get(`msp:${mspKey}`);
    let list = parseJson(listRaw) || [];

    if (list.some((t) => t.tenantId === tenant)) {
      res.status(200).json({ ok: true, mspKey, alreadyLinked: true });
      return;
    }

    if (list.length >= MAX_TENANTS_PER_MSP) {
      res.status(400).json({ error: `This dashboard already tracks the maximum of ${MAX_TENANTS_PER_MSP} tenants.`, code: "MSP_TENANT_LIMIT_REACHED" });
      return;
    }

    if (list.length >= FREE_TENANT_LIMIT) {
      const proRaw = await redis.get(`msp-pro:${mspKey}`);
      const pro = parseJson(proRaw);
      if (!pro || !pro.active) {
        res.status(402).json({
          error: `The free plan tracks ${FREE_TENANT_LIMIT} tenant. Upgrade to Pro to add unlimited tenants to this dashboard.`,
          code: "UPGRADE_REQUIRED",
          requiresUpgrade: true,
          mspKey,
        });
        return;
      }
    }

    list.push({
      tenantId: tenant,
      accessToken,
      label: label || null,
      linkedAt: Date.now(),
    });

    await redis.set(`msp:${mspKey}`, JSON.stringify(list), { ex: RETENTION_SECONDS });

    res.status(200).json({ ok: true, mspKey, alreadyLinked: false });
  } catch (e) {
    res.status(500).json({ error: "Could not link this tenant to a dashboard. Please try again.", code: "MSP_LINK_FAILED" });
  }
};
