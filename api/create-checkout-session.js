const Stripe = require("stripe");
const { Redis } = require("@upstash/redis");
const redis = Redis.fromEnv();

const IP_LIMIT = 10;
const IP_WINDOW_SECONDS = 60 * 60; // 1 hour

function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

// Creates a Stripe Checkout session to upgrade an MSP dashboard to Pro
// (unlimited tenants, currently free tier is capped at 1 - see msp-link.js).
// The mspKey is passed through as Checkout metadata so the webhook knows
// which dashboard to unlock once payment succeeds.
module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!secretKey || !priceId) {
    res.status(500).json({ error: "Payments aren't configured yet (missing STRIPE_SECRET_KEY / STRIPE_PRICE_ID)." });
    return;
  }

  const { mspKey } = req.body || {};
  if (!mspKey) {
    res.status(400).json({ error: "mspKey is required." });
    return;
  }

  // Cheap abuse guard (fail open on Redis errors, same pattern as api/scan.js).
  try {
    const ip = getClientIp(req);
    const key = `ratelimit:checkout:${ip}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, IP_WINDOW_SECONDS);
    if (count > IP_LIMIT) {
      res.status(429).json({ error: "Too many checkout attempts from your network. Please try again later." });
      return;
    }
  } catch (e) {
    // Redis unavailable - allow through rather than block a paying customer.
  }

  try {
    // mspKey must already exist (i.e. at least one tenant has been linked)
    // so we're not selling an upgrade for a dashboard that doesn't exist yet.
    const listRaw = await redis.get(`msp:${mspKey}`);
    if (!listRaw) {
      res.status(400).json({ error: "Link at least one tenant to this dashboard before upgrading." });
      return;
    }

    const stripe = Stripe(secretKey);
    const origin = `https://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/?msp=${encodeURIComponent(mspKey)}&upgraded=1`,
      cancel_url: `${origin}/?msp=${encodeURIComponent(mspKey)}`,
      client_reference_id: mspKey,
      metadata: { mspKey },
      subscription_data: { metadata: { mspKey } },
    });

    res.status(200).json({ url: session.url });
  } catch (e) {
    res.status(500).json({ error: "Could not start checkout. Please try again.", detail: String(e.message || e) });
  }
};
