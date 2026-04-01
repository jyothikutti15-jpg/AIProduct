const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("./db");

const JWT_SECRET = process.env.JWT_SECRET || "contractshield-dev-secret-change-in-production";
const JWT_EXPIRES = "7d";

// Plan limits
const PLAN_LIMITS = {
  free: { analyses: 3, chat: 10, compare: 0, generate: 0, name: "Free" },
  starter: { analyses: 10, chat: 50, compare: 5, generate: 5, name: "Starter" },
  professional: { analyses: 50, chat: -1, compare: -1, generate: -1, name: "Professional" },
  enterprise: { analyses: -1, chat: -1, compare: -1, generate: -1, name: "Enterprise" },
};

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, plan: user.plan },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

// Middleware: require auth
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const decoded = verifyToken(authHeader.substring(7));
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(decoded.id);
    if (!user) return res.status(401).json({ error: "User not found" });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Middleware: optional auth (doesn't block if no token)
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const decoded = verifyToken(authHeader.substring(7));
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(decoded.id);
      if (user) req.user = user;
    } catch {}
  }
  next();
}

// Middleware: check usage limits
function checkLimit(featureKey) {
  return (req, res, next) => {
    if (!req.user) return next(); // Allow unauthenticated demo usage

    const limits = PLAN_LIMITS[req.user.plan] || PLAN_LIMITS.free;
    const limit = limits[featureKey];

    if (limit === -1) return next(); // Unlimited
    if (limit === 0) {
      return res.status(403).json({
        error: `This feature requires a ${featureKey === "compare" ? "Professional" : "Starter"} plan or higher.`,
        upgrade: true,
      });
    }

    if (featureKey === "analyses") {
      // Reset monthly counter
      const resetAt = new Date(req.user.analyses_reset_at);
      const now = new Date();
      if (now.getMonth() !== resetAt.getMonth() || now.getFullYear() !== resetAt.getFullYear()) {
        db.prepare("UPDATE users SET analyses_used = 0, analyses_reset_at = datetime('now') WHERE id = ?").run(req.user.id);
        req.user.analyses_used = 0;
      }

      if (req.user.analyses_used >= limit) {
        return res.status(403).json({
          error: `You've reached your monthly limit of ${limit} analyses. Upgrade your plan for more.`,
          upgrade: true,
          current: req.user.analyses_used,
          limit,
        });
      }
    }

    next();
  };
}

// Increment usage counter
function incrementUsage(userId) {
  db.prepare("UPDATE users SET analyses_used = analyses_used + 1, updated_at = datetime('now') WHERE id = ?").run(userId);
}

// Save analysis to user history
function saveAnalysis(userId, analysis) {
  db.prepare(
    "INSERT INTO analyses (user_id, analysis_id, filename, document_type, risk_score, risk_label, data) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(
    userId,
    analysis.id || "",
    analysis.filename || "",
    analysis.document_type || "",
    analysis.overall_risk_score || 0,
    analysis.overall_risk_label || "",
    JSON.stringify(analysis)
  );
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateToken,
  verifyToken,
  requireAuth,
  optionalAuth,
  checkLimit,
  incrementUsage,
  saveAnalysis,
  PLAN_LIMITS,
};
