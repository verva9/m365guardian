const Stripe = require("stripe");
const { Redis } = require("@upstash/redis");
const { parseJson } = require("../lib/redisJson");
const { isBoundedString } = require("../lib/security");
const redis = Redis.fromEnv();

// Lets a Pro customer self-serve manage or cancel their subscription via
// Stripe's hosted Billing Portal, instead of emailing you to cancel.
module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed", code: "METHOD_NOT_ALLOWED" });
    return;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    res.status(500).json({ error: "Payments aren't configured yet.", code: "STRIPE_CONFIG_MISSING" });
    return;
  }

  const { mspKey } = req.body || {};
  if (!isBoundedString(mspKey, 128)) {
    res.status(400).json({ error: "mspKey is required.", code: "MISSING_PARAMS" });
    return;
  }

  try {
    const proRaw = await redis.get(`msp-pro:${mspKey}`);
    const pro = parseJson(proRaw);
    if (!pro || !pro.active || !pro.customerId) {
      res.status(400).json({ error: "This dashboard doesn't have an active Pro subscription.", code: "NOT_PRO" });
      return;
    }

    const stripe = Stripe(secretKey);
    const origin = `https://${req.headers.host}`;
    const session = await stripe.billingPortal.sessions.create({
      customer: pro.customerId,
      return_url: `${origin}/?msp=${encodeURIComponent(mspKey)}`,
    });

    res.status(200).json({ url: session.url });
  } catch (e) {
    res.status(500).json({ error: "Could not open billing portal.", code: "PORTAL_SESSION_FAILED", detail: String(e.message || e).slice(0, 300) });
  }
};
