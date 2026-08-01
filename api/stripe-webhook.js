const Stripe = require("stripe");
const { Redis } = require("@upstash/redis");
const redis = Redis.fromEnv();

// Stripe requires the raw, unparsed request body to verify webhook
// signatures, so body parsing is disabled for this route.
module.exports.config = { api: { bodyParser: false } };

function buffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    res.status(500).json({ error: "Stripe webhook not configured." });
    return;
  }

  const stripe = Stripe(secretKey);
  const sig = req.headers["stripe-signature"];
  const rawBody = await buffer(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (e) {
    res.status(400).json({ error: `Webhook signature verification failed: ${e.message}` });
    return;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const mspKey = session.metadata?.mspKey || session.client_reference_id;
        if (mspKey) {
          await redis.set(`msp-pro:${mspKey}`, JSON.stringify({
            active: true,
            subscriptionId: session.subscription,
            customerId: session.customer,
            upgradedAt: Date.now(),
          }));
        }
        break;
      }
      case "customer.subscription.deleted":
      case "customer.subscription.paused": {
        const sub = event.data.object;
        const mspKey = sub.metadata?.mspKey;
        if (mspKey) {
          await redis.del(`msp-pro:${mspKey}`);
        }
        break;
      }
      default:
        break; // ignore other event types
    }
    res.status(200).json({ received: true });
  } catch (e) {
    res.status(500).json({ error: "Webhook handling failed.", detail: String(e.message || e) });
  }
};
