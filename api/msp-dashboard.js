const { Redis } = require("@upstash/redis");
const redis = Redis.fromEnv();

// Returns the latest score for every tenant linked to an MSP dashboard key.
// The mspKey itself is the credential - anyone holding it can see this list,
// same trust model as a tenant's own access token.
module.exports = async (req, res) => {
  const { mspKey } = req.query;
  if (!mspKey) {
    res.status(400).json({ error: "mspKey query param is required." });
    return;
  }

  try {
    const [listRaw, proRaw] = await Promise.all([
      redis.get(`msp:${mspKey}`),
      redis.get(`msp-pro:${mspKey}`),
    ]);
    const list = listRaw ? JSON.parse(listRaw) : [];
    const pro = proRaw ? JSON.parse(proRaw) : null;
    const isPro = !!(pro && pro.active);

    if (list.length === 0) {
      res.status(200).json({ tenants: [], isPro });
      return;
    }

    const tenants = await Promise.all(
      list.map(async (entry) => {
        let score = null;
        let tenantName = null;
        let scannedAt = null;
        try {
          const scanRaw = await redis.get(`scan:${entry.tenantId}`);
          if (scanRaw) {
            const scan = JSON.parse(scanRaw);
            score = typeof scan.score === "number" ? scan.score : null;
            tenantName = scan.tenantName || null;
            scannedAt = scan.scannedAt || null;
          }
        } catch (e) {
          // leave as null - tenant just hasn't been scanned yet or scan expired
        }
        return {
          tenantId: entry.tenantId,
          accessToken: entry.accessToken,
          label: entry.label,
          linkedAt: entry.linkedAt,
          score,
          tenantName,
          scannedAt,
        };
      })
    );

    tenants.sort((a, b) => (a.score ?? 999) - (b.score ?? 999)); // worst scores first

    res.status(200).json({ tenants, isPro });
  } catch (e) {
    res.status(500).json({ error: "Could not load dashboard." });
  }
};
