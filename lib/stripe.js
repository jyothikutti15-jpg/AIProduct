const db = require("./db");

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

let stripe = null;
if (STRIPE_SECRET) {
  stripe = require("stripe")(STRIPE_SECRET);
}

// Map Stripe price IDs to plan names (configure these in your Stripe dashboard)
const PRICE_TO_PLAN = {
  [process.env.STRIPE_STARTER_PRICE_ID || "price_starter"]: "starter",
  [process.env.STRIPE_PRO_PRICE_ID || "price_professional"]: "professional",
  [process.env.STRIPE_ENTERPRISE_PRICE_ID || "price_enterprise"]: "enterprise",
};

const PLAN_TO_PRICE = {};
for (const [priceId, plan] of Object.entries(PRICE_TO_PLAN)) {
  PLAN_TO_PRICE[plan] = priceId;
}

async function createCheckoutSession(user, planName, successUrl, cancelUrl) {
  if (!stripe) throw new Error("Stripe is not configured. Add STRIPE_SECRET_KEY to .env");

  const priceId = PLAN_TO_PRICE[planName];
  if (!priceId) throw new Error("Invalid plan: " + planName);

  // Get or create Stripe customer
  let customerId = user.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.name,
      metadata: { userId: user.id.toString() },
    });
    customerId = customer.id;
    db.prepare("UPDATE users SET stripe_customer_id = ? WHERE id = ?").run(customerId, user.id);
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl || `${process.env.APP_URL || "http://localhost:3001"}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl || `${process.env.APP_URL || "http://localhost:3001"}/pricing`,
    metadata: { userId: user.id.toString(), plan: planName },
  });

  return session;
}

async function createBillingPortalSession(user) {
  if (!stripe) throw new Error("Stripe is not configured");
  if (!user.stripe_customer_id) throw new Error("No subscription found");

  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripe_customer_id,
    return_url: `${process.env.APP_URL || "http://localhost:3001"}/settings`,
  });

  return session;
}

function handleWebhookEvent(event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const userId = parseInt(session.metadata?.userId);
      const plan = session.metadata?.plan;
      if (userId && plan) {
        db.prepare(
          "UPDATE users SET plan = ?, stripe_subscription_id = ?, analyses_used = 0, analyses_reset_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
        ).run(plan, session.subscription, userId);
        console.log(`User ${userId} upgraded to ${plan}`);
      }
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object;
      const priceId = subscription.items?.data?.[0]?.price?.id;
      const plan = PRICE_TO_PLAN[priceId] || "free";
      const customer = db.prepare("SELECT * FROM users WHERE stripe_customer_id = ?").get(subscription.customer);
      if (customer) {
        db.prepare("UPDATE users SET plan = ?, stripe_subscription_id = ?, updated_at = datetime('now') WHERE id = ?")
          .run(plan, subscription.id, customer.id);
        console.log(`User ${customer.id} plan updated to ${plan}`);
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      const customer = db.prepare("SELECT * FROM users WHERE stripe_customer_id = ?").get(subscription.customer);
      if (customer) {
        db.prepare("UPDATE users SET plan = 'free', stripe_subscription_id = NULL, updated_at = datetime('now') WHERE id = ?")
          .run(customer.id);
        console.log(`User ${customer.id} downgraded to free (subscription cancelled)`);
      }
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object;
      const customer = db.prepare("SELECT * FROM users WHERE stripe_customer_id = ?").get(invoice.customer);
      if (customer) {
        console.warn(`Payment failed for user ${customer.id} (${customer.email})`);
      }
      break;
    }
  }
}

module.exports = {
  stripe,
  createCheckoutSession,
  createBillingPortalSession,
  handleWebhookEvent,
  STRIPE_WEBHOOK_SECRET,
  PLAN_TO_PRICE,
};
