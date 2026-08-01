const Stripe = require("stripe");
const { Redis } = require("@upstash/redis");
const redis = Redis.fromEnv();

// Lets a Pro customer self-serve manage or cancel their subscription via
// Stripe's hosted Billing Portal, instead of emailing you to cancel.
module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    res.status(500).json({ error: "Payments aren't configured yet." });
    return;
  }

  const { mspKey } = req.body || {};
  if (!mspKey) {
    res.status(400).json({ error: "mspKey is required." });
    return;
  }

  try {
    const proRaw = await redis.get(`msp-pro:${mspKey}`);
    const pro = proRaw ? JSON.parse(proRaw) : null;
    if (!pro || !pro.active || !pro.customerId) {
      res.status(400).json({ error: "This dashboard doesn't have an active Pro subscription." });
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
    res.status(500).json({ error: "Could not open billing portal.", detail: String(e.message || e) });
  }
};
