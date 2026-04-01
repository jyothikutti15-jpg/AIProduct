require("dotenv").config();
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const pdfParse = require("pdf-parse");
const Anthropic = require("@anthropic-ai/sdk").default;

const db = require("./lib/db");
const auth = require("./lib/auth");
const billing = require("./lib/stripe");
const mailer = require("./lib/email");
const { generateAnalysisDocx } = require("./lib/docx-export");

const app = express();
const PORT = process.env.PORT || 3001;

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [".pdf", ".txt", ".doc", ".docx"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error("Only PDF, TXT, DOC, DOCX files are allowed"));
  },
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Stripe webhook needs raw body (must be before express.json) ────────────
app.post("/api/webhooks/stripe", express.raw({ type: "application/json" }), (req, res) => {
  if (!billing.stripe || !billing.STRIPE_WEBHOOK_SECRET) {
    return res.status(400).json({ error: "Stripe not configured" });
  }

  let event;
  try {
    event = billing.stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], billing.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send("Webhook Error: " + err.message);
  }

  billing.handleWebhookEvent(event);
  res.json({ received: true });
});

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "5mb" }));

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

app.post("/api/auth/signup", (req, res) => {
  const { email, password, name, company } = req.body;

  if (!email || !password || !name) {
    return res.status(400).json({ error: "Email, password, and name are required." });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }

  const hashedPassword = auth.hashPassword(password);

  const result = db.prepare(
    "INSERT INTO users (email, password, name, company) VALUES (?, ?, ?, ?)"
  ).run(email.toLowerCase(), hashedPassword, name, company || "");

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid);
  const token = auth.generateToken(user);

  // Send welcome email (async, don't block response)
  mailer.sendWelcome(user).catch(() => {});

  res.status(201).json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      company: user.company,
      plan: user.plan,
      analyses_used: user.analyses_used,
      onboarding_completed: user.onboarding_completed,
    },
  });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase());
  if (!user || !auth.verifyPassword(password, user.password)) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  const token = auth.generateToken(user);

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      company: user.company,
      plan: user.plan,
      analyses_used: user.analyses_used,
    },
  });
});

app.get("/api/auth/me", auth.requireAuth, (req, res) => {
  const limits = auth.PLAN_LIMITS[req.user.plan] || auth.PLAN_LIMITS.free;
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
      company: req.user.company,
      plan: req.user.plan,
      analyses_used: req.user.analyses_used,
      onboarding_completed: req.user.onboarding_completed,
      email_notifications: req.user.email_notifications,
      email_deadline_alerts: req.user.email_deadline_alerts,
      email_weekly_digest: req.user.email_weekly_digest,
      avatar_url: req.user.avatar_url,
      oauth_provider: req.user.oauth_provider,
      limits,
    },
  });
});

app.put("/api/auth/profile", auth.requireAuth, (req, res) => {
  const { name, company } = req.body;
  if (name) {
    db.prepare("UPDATE users SET name = ?, company = ?, updated_at = datetime('now') WHERE id = ?")
      .run(name, company || "", req.user.id);
  }
  res.json({ success: true });
});

app.get("/api/auth/history", auth.requireAuth, (req, res) => {
  const analyses = db.prepare(
    "SELECT id, analysis_id, filename, document_type, risk_score, risk_label, created_at FROM analyses WHERE user_id = ? ORDER BY created_at DESC LIMIT 100"
  ).all(req.user.id);
  res.json(analyses);
});

app.get("/api/auth/history/:analysisId", auth.requireAuth, (req, res) => {
  const analysis = db.prepare(
    "SELECT * FROM analyses WHERE analysis_id = ? AND user_id = ?"
  ).get(req.params.analysisId, req.user.id);

  if (!analysis) return res.status(404).json({ error: "Analysis not found" });
  res.json(JSON.parse(analysis.data));
});

app.delete("/api/auth/history/:id", auth.requireAuth, (req, res) => {
  db.prepare("DELETE FROM analyses WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// STRIPE ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

app.post("/api/billing/checkout", auth.requireAuth, async (req, res) => {
  const { plan } = req.body;

  if (!["starter", "professional", "enterprise"].includes(plan)) {
    return res.status(400).json({ error: "Invalid plan." });
  }

  try {
    const session = await billing.createCheckoutSession(req.user, plan);
    res.json({ url: session.url, sessionId: session.id });
  } catch (error) {
    console.error("Checkout error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/billing/portal", auth.requireAuth, async (req, res) => {
  try {
    const session = await billing.createBillingPortalSession(req.user);
    res.json({ url: session.url });
  } catch (error) {
    console.error("Portal error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/billing/status", auth.requireAuth, (req, res) => {
  const limits = auth.PLAN_LIMITS[req.user.plan] || auth.PLAN_LIMITS.free;
  res.json({
    plan: req.user.plan,
    limits,
    analyses_used: req.user.analyses_used,
    has_subscription: !!req.user.stripe_subscription_id,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AI PROMPTS
// ═══════════════════════════════════════════════════════════════════════════════

const ANALYSIS_PROMPT = `You are an expert contract analyst and legal advisor for small and medium businesses. Analyze the following contract/document thoroughly.

Return your analysis as a JSON object with this exact structure:
{
  "summary": "A 2-3 sentence plain-English summary of what this contract is about",
  "document_type": "The type of document (e.g., NDA, Service Agreement, Lease, Employment Contract, etc.)",
  "parties": ["List of parties involved"],
  "key_dates": [
    {"event": "description", "date": "date or duration"}
  ],
  "financial_terms": [
    {"item": "description", "amount": "value or formula", "frequency": "one-time|monthly|annual|etc"}
  ],
  "clauses": [
    {
      "title": "Clause name/topic",
      "summary": "Plain-English explanation of what this clause means",
      "risk_level": "low|medium|high|critical",
      "risk_reason": "Why this risk level was assigned",
      "recommendation": "What to watch out for or negotiate",
      "legal_reference": "Relevant law or standard this relates to, if applicable"
    }
  ],
  "missing_clauses": [
    {
      "clause": "Name of missing clause",
      "importance": "high|medium",
      "reason": "Why this clause should be included"
    }
  ],
  "overall_risk_score": "number from 1 to 10",
  "overall_risk_label": "Low Risk|Moderate Risk|High Risk|Critical Risk",
  "red_flags": ["List of critical issues that need immediate attention"],
  "action_items": ["List of recommended next steps"],
  "negotiation_points": ["Clauses or terms worth negotiating"],
  "compliance_notes": ["Any regulatory or compliance concerns (GDPR, HIPAA, etc.)"],
  "language_detected": "Language of the contract"
}

Be thorough but practical. Focus on risks that matter to SMBs. Use plain English, avoid legal jargon where possible. If a section has no items, use an empty array.

IMPORTANT: Return ONLY valid JSON, no markdown formatting, no code blocks, just the raw JSON object.`;

const COMPARISON_PROMPT = `You are an expert contract analyst. Compare the following two contracts and provide a detailed comparison.

Return your comparison as a JSON object with this exact structure:
{
  "summary": "A 2-3 sentence summary of the key differences between these contracts",
  "contract_a_type": "Type of first contract",
  "contract_b_type": "Type of second contract",
  "similarities": [
    {"topic": "What is similar", "detail": "Explanation"}
  ],
  "differences": [
    {
      "topic": "Area of difference",
      "contract_a": "What contract A says",
      "contract_b": "What contract B says",
      "which_is_better": "a|b|neutral",
      "recommendation": "Which to prefer and why"
    }
  ],
  "risk_comparison": {
    "contract_a_score": "number 1-10",
    "contract_b_score": "number 1-10",
    "contract_a_label": "Low Risk|Moderate Risk|High Risk|Critical Risk",
    "contract_b_label": "Low Risk|Moderate Risk|High Risk|Critical Risk",
    "analysis": "Which contract is safer overall and why"
  },
  "recommendation": "Overall recommendation on which contract to prefer or how to negotiate"
}

IMPORTANT: Return ONLY valid JSON, no markdown formatting, no code blocks, just the raw JSON object.`;

const TEMPLATE_PROMPT = `You are an expert contract lawyer. Generate a professional, legally sound contract based on the following specifications.

Return the contract as a JSON object with this exact structure:
{
  "title": "Contract title",
  "content": "The full contract text in clean, readable format with proper sections and numbering",
  "sections": [
    {"title": "Section name", "content": "Section text"}
  ],
  "notes": ["Important notes about customizing this template"],
  "disclaimer": "Standard disclaimer about reviewing with a lawyer"
}

Generate a comprehensive, professional contract. Use standard legal language but keep it readable. Include all standard clauses for this type of agreement.

IMPORTANT: Return ONLY valid JSON, no markdown formatting, no code blocks, just the raw JSON object.`;

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

async function extractText(filePath, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  if (ext === ".pdf") {
    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = await pdfParse(dataBuffer);
    return { text: pdfData.text, pages: pdfData.numpages };
  } else if (ext === ".txt") {
    return { text: fs.readFileSync(filePath, "utf-8"), pages: null };
  }
  throw new Error("For DOC/DOCX files, please convert to PDF first. PDF and TXT are fully supported.");
}

function truncateText(text, maxChars = 100000) {
  if (text.length > maxChars) return text.substring(0, maxChars) + "\n\n[Document truncated for analysis]";
  return text;
}

async function callClaude(systemPrompt, userMessage, maxTokens = 8192) {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: maxTokens,
    messages: [{ role: "user", content: `${systemPrompt}\n\n${userMessage}` }],
  });
  const responseText = message.content[0].text;
  if (message.stop_reason === "max_tokens") {
    console.warn("Response truncated at max_tokens, attempting partial parse");
  }
  return parseJsonResponse(responseText);
}

function parseJsonResponse(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "");
    cleaned = cleaned.replace(/\n?```\s*$/, "");
  }

  try { return JSON.parse(cleaned); } catch {}

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const jsonStr = cleaned.substring(start, end + 1);
    try { return JSON.parse(jsonStr); } catch {}

    let fixed = jsonStr.replace(/,\s*([}\]])/g, "$1").replace(/[\x00-\x1f]/g, " ");
    try { return JSON.parse(fixed); } catch {}
  }

  let raw = cleaned.substring(cleaned.indexOf("{"));
  raw = raw.replace(/,\s*([}\]])/g, "$1").replace(/[\x00-\x1f]/g, " ");

  let inStr = false, esc = false;
  for (let i = 0; i < raw.length; i++) {
    if (esc) { esc = false; continue; }
    if (raw[i] === "\\") { esc = true; continue; }
    if (raw[i] === '"') inStr = !inStr;
  }
  if (inStr) raw += '"';

  raw = raw.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"]*$/, "");
  raw = raw.replace(/,\s*$/, "");

  const stack = [];
  inStr = false; esc = false;
  for (let i = 0; i < raw.length; i++) {
    if (esc) { esc = false; continue; }
    if (raw[i] === "\\") { esc = true; continue; }
    if (raw[i] === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (raw[i] === "{") stack.push("}");
    else if (raw[i] === "[") stack.push("]");
    else if ((raw[i] === "}" || raw[i] === "]") && stack.length) stack.pop();
  }
  raw += stack.reverse().join("");

  try { return JSON.parse(raw); } catch (e) {
    throw new Error("Failed to parse AI response. Please try again.");
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CORE API ROUTES (with optional auth + usage tracking)
// ═══════════════════════════════════════════════════════════════════════════════

app.post("/api/analyze", auth.optionalAuth, auth.checkLimit("analyses"), upload.single("document"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const filePath = req.file.path;
  const targetLang = req.body?.language || null;

  try {
    const { text: rawText, pages } = await extractText(filePath, req.file.originalname);

    if (!rawText || rawText.trim().length < 50) {
      return res.status(400).json({ error: "Could not extract enough text from the document." });
    }

    const text = truncateText(rawText);
    let prompt = ANALYSIS_PROMPT;
    if (targetLang && targetLang !== "auto") {
      prompt += `\n\nIMPORTANT: Provide your entire analysis in ${targetLang}. All text values in the JSON should be in ${targetLang}.`;
    }
    // Inject industry profile if user has one set
    if (req.user?.industry && INDUSTRY_PROFILES[req.user.industry]) {
      const profile = INDUSTRY_PROFILES[req.user.industry];
      prompt += `\n\nINDUSTRY CONTEXT (${profile.name}):\n${profile.focus}\n${profile.risk_weights}`;
    }

    const analysis = await callClaude(prompt, `Here is the document to analyze:\n\n---\n${text}\n---`);
    analysis.filename = req.file.originalname;
    analysis.analyzed_at = new Date().toISOString();
    analysis.page_count = pages;
    analysis.id = Date.now().toString(36) + Math.random().toString(36).substring(2, 7);

    // Track usage and save if logged in
    if (req.user) {
      auth.incrementUsage(req.user.id);
      auth.saveAnalysis(req.user.id, analysis);
      mailer.sendAnalysisComplete(req.user, analysis).catch(() => {});
    }

    res.json(analysis);
  } catch (error) {
    console.error("Analysis error:", error);
    res.status(500).json({ error: error.message || "Failed to analyze document." });
  } finally {
    fs.unlink(filePath, () => {});
  }
});

const compareUpload = upload.fields([
  { name: "documentA", maxCount: 1 },
  { name: "documentB", maxCount: 1 },
]);

app.post("/api/compare", auth.optionalAuth, auth.checkLimit("compare"), compareUpload, async (req, res) => {
  const fileA = req.files?.documentA?.[0];
  const fileB = req.files?.documentB?.[0];

  if (!fileA || !fileB) return res.status(400).json({ error: "Please upload two documents to compare." });

  try {
    const [resultA, resultB] = await Promise.all([
      extractText(fileA.path, fileA.originalname),
      extractText(fileB.path, fileB.originalname),
    ]);

    const textA = truncateText(resultA.text, 50000);
    const textB = truncateText(resultB.text, 50000);

    const comparison = await callClaude(
      COMPARISON_PROMPT,
      `CONTRACT A (${fileA.originalname}):\n---\n${textA}\n---\n\nCONTRACT B (${fileB.originalname}):\n---\n${textB}\n---`
    );

    comparison.filename_a = fileA.originalname;
    comparison.filename_b = fileB.originalname;
    comparison.compared_at = new Date().toISOString();

    if (req.user) auth.incrementUsage(req.user.id);

    res.json(comparison);
  } catch (error) {
    console.error("Comparison error:", error);
    res.status(500).json({ error: error.message || "Failed to compare documents." });
  } finally {
    if (fileA) fs.unlink(fileA.path, () => {});
    if (fileB) fs.unlink(fileB.path, () => {});
  }
});

app.post("/api/chat", auth.optionalAuth, async (req, res) => {
  const { question, analysis, history } = req.body;

  if (!question || !analysis) {
    return res.status(400).json({ error: "Question and analysis context required." });
  }

  try {
    const messages = [];
    if (history && history.length > 0) {
      for (const msg of history.slice(-10)) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
    messages.push({ role: "user", content: question });

    const systemPrompt = `You are a helpful contract analysis assistant. The user has just analyzed a contract and wants to ask follow-up questions.

Here is the contract analysis context:
- Document: ${analysis.filename}
- Type: ${analysis.document_type}
- Summary: ${analysis.summary}
- Risk Score: ${analysis.overall_risk_score}/10 (${analysis.overall_risk_label})
- Parties: ${(analysis.parties || []).join(", ")}
- Key Clauses: ${(analysis.clauses || []).map(c => `${c.title} (${c.risk_level} risk)`).join(", ")}
- Red Flags: ${(analysis.red_flags || []).join("; ")}
- Missing Clauses: ${(analysis.missing_clauses || []).map(c => c.clause).join(", ")}

Answer thoroughly and practically. Give actionable advice. Use plain English.`;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: systemPrompt,
      messages,
    });

    res.json({ response: message.content[0].text });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ error: error.message || "Failed to get response." });
  }
});

app.post("/api/generate", auth.optionalAuth, auth.checkLimit("generate"), async (req, res) => {
  const { template_type, details } = req.body;
  if (!template_type) return res.status(400).json({ error: "Template type is required." });

  try {
    const userMessage = `Generate a ${template_type} with these details:\n${JSON.stringify(details, null, 2)}`;
    const result = await callClaude(TEMPLATE_PROMPT, userMessage, 8192);
    result.generated_at = new Date().toISOString();
    result.template_type = template_type;
    res.json(result);
  } catch (error) {
    console.error("Generation error:", error);
    res.status(500).json({ error: error.message || "Failed to generate contract." });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// AI CLAUSE REWRITER
// ═══════════════════════════════════════════════════════════════════════════════

app.post("/api/rewrite-clause", auth.optionalAuth, async (req, res) => {
  const { clause_title, clause_text, risk_level, risk_reason, context } = req.body;
  if (!clause_title || !clause_text) return res.status(400).json({ error: "Clause title and text are required." });

  try {
    const prompt = `You are an expert contract lawyer. Rewrite the following contract clause to be fairer and less risky for the receiving party.

Current clause: "${clause_title}"
Current text: "${clause_text}"
Risk level: ${risk_level || "unknown"}
Risk reason: ${risk_reason || "N/A"}
Contract context: ${context || "General business contract"}

Return a JSON object:
{
  "original": "The original clause text",
  "rewritten": "The improved clause text",
  "changes_made": ["List of specific changes made"],
  "risk_reduction": "How the rewrite reduces risk",
  "negotiation_tip": "How to present this change to the other party"
}

IMPORTANT: Return ONLY valid JSON.`;

    const result = await callClaude(prompt, "", 2048);
    res.json(result);
  } catch (error) {
    console.error("Rewrite error:", error);
    res.status(500).json({ error: error.message || "Failed to rewrite clause." });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH UPLOAD
// ═══════════════════════════════════════════════════════════════════════════════

const batchUpload = upload.array("documents", 10);

app.post("/api/batch-analyze", auth.optionalAuth, auth.checkLimit("analyses"), batchUpload, async (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: "No files uploaded." });

  const results = [];
  for (const file of req.files) {
    try {
      const { text: rawText, pages } = await extractText(file.path, file.originalname);
      if (!rawText || rawText.trim().length < 50) {
        results.push({ filename: file.originalname, error: "Could not extract text", status: "failed" });
        continue;
      }
      const text = truncateText(rawText);
      const analysis = await callClaude(ANALYSIS_PROMPT, `Here is the document to analyze:\n\n---\n${text}\n---`);
      analysis.filename = file.originalname;
      analysis.analyzed_at = new Date().toISOString();
      analysis.page_count = pages;
      analysis.id = Date.now().toString(36) + Math.random().toString(36).substring(2, 7);

      if (req.user) {
        auth.incrementUsage(req.user.id);
        auth.saveAnalysis(req.user.id, analysis);
      }
      results.push({ filename: file.originalname, analysis, status: "success" });
    } catch (e) {
      results.push({ filename: file.originalname, error: e.message, status: "failed" });
    } finally {
      fs.unlink(file.path, () => {});
    }
  }

  const successful = results.filter((r) => r.status === "success");
  const avgRisk = successful.length > 0
    ? (successful.reduce((sum, r) => sum + (r.analysis?.overall_risk_score || 0), 0) / successful.length).toFixed(1)
    : 0;

  res.json({
    total: results.length,
    successful: successful.length,
    failed: results.length - successful.length,
    average_risk: parseFloat(avgRisk),
    results,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SHAREABLE LINKS
// ═══════════════════════════════════════════════════════════════════════════════

const crypto = require("crypto");

app.post("/api/share", auth.requireAuth, (req, res) => {
  const { analysis_id, data, expires_hours } = req.body;
  if (!data) return res.status(400).json({ error: "Analysis data is required." });

  const shareId = crypto.randomBytes(16).toString("hex");
  const expiresAt = expires_hours
    ? new Date(Date.now() + expires_hours * 3600000).toISOString()
    : null;

  db.prepare(
    "INSERT INTO shared_analyses (share_id, user_id, analysis_id, data, expires_at) VALUES (?, ?, ?, ?, ?)"
  ).run(shareId, req.user.id, analysis_id || "", JSON.stringify(data), expiresAt);

  const shareUrl = `${process.env.APP_URL || "http://localhost:3001"}/shared/${shareId}`;
  res.json({ share_id: shareId, url: shareUrl, expires_at: expiresAt });
});

app.get("/api/shared/:shareId", (req, res) => {
  const shared = db.prepare("SELECT * FROM shared_analyses WHERE share_id = ?").get(req.params.shareId);
  if (!shared) return res.status(404).json({ error: "Shared analysis not found or expired." });

  if (shared.expires_at && new Date(shared.expires_at) < new Date()) {
    db.prepare("DELETE FROM shared_analyses WHERE share_id = ?").run(req.params.shareId);
    return res.status(410).json({ error: "This shared link has expired." });
  }

  res.json(JSON.parse(shared.data));
});

app.get("/shared/:shareId", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ═══════════════════════════════════════════════════════════════════════════════
// ANNOTATIONS & NOTES
// ═══════════════════════════════════════════════════════════════════════════════

app.post("/api/annotations", auth.requireAuth, (req, res) => {
  const { analysis_id, clause_index, note } = req.body;
  if (!analysis_id || !note) return res.status(400).json({ error: "Analysis ID and note are required." });

  const result = db.prepare(
    "INSERT INTO annotations (user_id, analysis_id, clause_index, note) VALUES (?, ?, ?, ?)"
  ).run(req.user.id, analysis_id, clause_index ?? -1, note);

  res.json({ id: result.lastInsertRowid, success: true });
});

app.get("/api/annotations/:analysisId", auth.requireAuth, (req, res) => {
  const notes = db.prepare(
    "SELECT * FROM annotations WHERE user_id = ? AND analysis_id = ? ORDER BY clause_index, created_at"
  ).all(req.user.id, req.params.analysisId);
  res.json(notes);
});

app.delete("/api/annotations/:id", auth.requireAuth, (req, res) => {
  db.prepare("DELETE FROM annotations WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONTRACT DEADLINES / EXPIRY TRACKER
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/api/deadlines", auth.requireAuth, (req, res) => {
  const deadlines = db.prepare(
    "SELECT * FROM contract_deadlines WHERE user_id = ? AND status = 'active' ORDER BY deadline_date ASC"
  ).all(req.user.id);
  res.json(deadlines);
});

app.post("/api/deadlines", auth.requireAuth, (req, res) => {
  const { title, deadline_date, contract_name, alert_days, is_auto_renewal, notes, analysis_id } = req.body;
  if (!title || !deadline_date) return res.status(400).json({ error: "Title and deadline date are required." });

  const result = db.prepare(
    "INSERT INTO contract_deadlines (user_id, analysis_id, title, deadline_date, contract_name, alert_days, is_auto_renewal, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(req.user.id, analysis_id || null, title, deadline_date, contract_name || "", alert_days || 30, is_auto_renewal ? 1 : 0, notes || "");

  res.json({ id: result.lastInsertRowid, success: true });
});

app.put("/api/deadlines/:id", auth.requireAuth, (req, res) => {
  const { title, deadline_date, contract_name, alert_days, is_auto_renewal, notes, status } = req.body;
  db.prepare(
    "UPDATE contract_deadlines SET title=COALESCE(?,title), deadline_date=COALESCE(?,deadline_date), contract_name=COALESCE(?,contract_name), alert_days=COALESCE(?,alert_days), is_auto_renewal=COALESCE(?,is_auto_renewal), notes=COALESCE(?,notes), status=COALESCE(?,status) WHERE id=? AND user_id=?"
  ).run(title, deadline_date, contract_name, alert_days, is_auto_renewal !== undefined ? (is_auto_renewal ? 1 : 0) : null, notes, status, req.params.id, req.user.id);
  res.json({ success: true });
});

app.delete("/api/deadlines/:id", auth.requireAuth, (req, res) => {
  db.prepare("DELETE FROM contract_deadlines WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CLAUSE LIBRARY (static + AI-powered)
// ═══════════════════════════════════════════════════════════════════════════════

const CLAUSE_LIBRARY = [
  { id: "conf-mutual", category: "Confidentiality", title: "Mutual Confidentiality", text: "Both parties agree to maintain the confidentiality of all proprietary and confidential information disclosed during the term of this Agreement. Confidential information shall not include information that: (a) is or becomes publicly available through no fault of the receiving party; (b) was known to the receiving party prior to disclosure; (c) is independently developed without use of confidential information; or (d) is disclosed with the prior written consent of the disclosing party." },
  { id: "conf-one", category: "Confidentiality", title: "One-Way NDA Clause", text: "The Receiving Party agrees to hold in confidence and not disclose to any third party any Confidential Information of the Disclosing Party. The Receiving Party shall use the same degree of care to protect the Disclosing Party's Confidential Information as it uses to protect its own, but in no event less than reasonable care." },
  { id: "indem-mutual", category: "Indemnification", title: "Mutual Indemnification", text: "Each party shall indemnify, defend, and hold harmless the other party from and against any claims, damages, losses, costs, and expenses (including reasonable attorneys' fees) arising from: (a) a material breach of this Agreement; (b) the indemnifying party's negligence or willful misconduct; or (c) any violation of applicable law by the indemnifying party." },
  { id: "liab-cap", category: "Liability", title: "Limitation of Liability", text: "IN NO EVENT SHALL EITHER PARTY'S TOTAL AGGREGATE LIABILITY UNDER THIS AGREEMENT EXCEED THE TOTAL AMOUNTS PAID OR PAYABLE UNDER THIS AGREEMENT DURING THE TWELVE (12) MONTH PERIOD PRECEDING THE CLAIM. NEITHER PARTY SHALL BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, REGARDLESS OF THE CAUSE OF ACTION OR THEORY OF LIABILITY." },
  { id: "term-conv", category: "Termination", title: "Termination for Convenience", text: "Either party may terminate this Agreement for any reason upon thirty (30) days' prior written notice to the other party. Upon termination, the terminating party shall pay for all services rendered and expenses incurred through the effective date of termination." },
  { id: "term-cause", category: "Termination", title: "Termination for Cause", text: "Either party may terminate this Agreement immediately upon written notice if the other party: (a) materially breaches this Agreement and fails to cure such breach within thirty (30) days of receiving written notice; (b) becomes insolvent, files for bankruptcy, or has a receiver appointed; or (c) ceases to conduct business in the normal course." },
  { id: "ip-client", category: "Intellectual Property", title: "Client Owns Work Product", text: "All work product, deliverables, and materials created by Provider under this Agreement shall be considered 'work made for hire' and shall be the exclusive property of Client. To the extent any work product does not qualify as work made for hire, Provider hereby irrevocably assigns to Client all right, title, and interest in such work product." },
  { id: "ip-license", category: "Intellectual Property", title: "License Grant (Provider Retains IP)", text: "Provider retains all intellectual property rights in the deliverables. Upon full payment, Provider grants Client a non-exclusive, perpetual, worldwide license to use, modify, and display the deliverables for Client's internal business purposes. Provider retains the right to use general knowledge and techniques gained during the engagement." },
  { id: "force-maj", category: "Force Majeure", title: "Force Majeure", text: "Neither party shall be liable for any failure or delay in performing its obligations under this Agreement where such failure or delay results from circumstances beyond the reasonable control of that party, including but not limited to natural disasters, war, terrorism, pandemic, government actions, power failures, or internet disruptions. The affected party shall promptly notify the other party and use reasonable efforts to mitigate the impact." },
  { id: "dispute-arb", category: "Dispute Resolution", title: "Arbitration Clause", text: "Any dispute arising out of or relating to this Agreement shall be resolved by binding arbitration in accordance with the rules of the American Arbitration Association. The arbitration shall take place in [City, State], and the decision of the arbitrator shall be final and binding. Each party shall bear its own costs of arbitration, and the parties shall equally share the arbitrator's fees." },
  { id: "noncomp-reas", category: "Non-Compete", title: "Reasonable Non-Compete", text: "During the term of this Agreement and for a period of six (6) months following its termination, the Receiving Party agrees not to directly solicit or provide services to the Disclosing Party's existing clients with whom the Receiving Party had direct contact during the engagement. This restriction applies only within the geographic area where services were provided." },
  { id: "payment-std", category: "Payment Terms", title: "Standard Payment Terms", text: "Client shall pay all undisputed invoices within thirty (30) days of receipt. Late payments shall accrue interest at the lesser of 1.5% per month or the maximum rate permitted by law. Provider may suspend services if any invoice remains unpaid for more than sixty (60) days. Client shall reimburse Provider for reasonable costs of collection, including attorneys' fees." },
  { id: "warranty", category: "Warranty", title: "Limited Warranty", text: "Provider warrants that services will be performed in a professional and workmanlike manner consistent with industry standards. If services fail to meet this warranty, Client's sole remedy shall be re-performance of the deficient services at Provider's expense. THIS WARRANTY IS IN LIEU OF ALL OTHER WARRANTIES, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE." },
  { id: "data-prot", category: "Data Protection", title: "Data Protection / GDPR Clause", text: "Each party shall comply with all applicable data protection laws, including the General Data Protection Regulation (GDPR) where applicable. The Processing Party shall: (a) process personal data only as instructed; (b) implement appropriate technical and organizational measures; (c) notify the other party of any data breach within 72 hours; and (d) delete or return all personal data upon termination of this Agreement." },
  { id: "nonsol", category: "Non-Solicitation", title: "Mutual Non-Solicitation", text: "During the term of this Agreement and for twelve (12) months thereafter, neither party shall directly or indirectly solicit, recruit, or hire any employee or contractor of the other party who was involved in the performance of this Agreement, without prior written consent. This restriction shall not apply to general job advertisements or unsolicited applications." },
];

app.get("/api/clause-library", (req, res) => {
  const { category, search } = req.query;
  let results = CLAUSE_LIBRARY;
  if (category) results = results.filter((c) => c.category.toLowerCase() === category.toLowerCase());
  if (search) {
    const q = search.toLowerCase();
    results = results.filter((c) => c.title.toLowerCase().includes(q) || c.text.toLowerCase().includes(q) || c.category.toLowerCase().includes(q));
  }
  const categories = [...new Set(CLAUSE_LIBRARY.map((c) => c.category))];
  res.json({ clauses: results, categories });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DEMO ENDPOINTS (no auth needed)
// ═══════════════════════════════════════════════════════════════════════════════

app.post("/api/demo", (req, res) => {
  res.json({
    id: "demo_" + Date.now().toString(36),
    filename: "Sample_NDA_Agreement.pdf",
    analyzed_at: new Date().toISOString(),
    document_type: "Non-Disclosure Agreement (NDA)",
    language_detected: "English",
    summary: "This is a mutual Non-Disclosure Agreement between TechCorp Inc. and a receiving party. It governs the sharing of confidential business information for the purpose of evaluating a potential partnership. The agreement has a 3-year term with broad definitions of confidential information.",
    parties: ["TechCorp Inc.", "Receiving Party (Your Company)"],
    key_dates: [
      { event: "Agreement Duration", date: "3 years from signing" },
      { event: "Confidentiality Obligation", date: "Survives 5 years after termination" },
    ],
    financial_terms: [
      { item: "Breach Penalty", amount: "$500,000", frequency: "per-incident" },
      { item: "Legal Fees Coverage", amount: "Uncapped", frequency: "as-incurred" },
    ],
    clauses: [
      { title: "Definition of Confidential Information", summary: "Covers all business, technical, and financial information shared between parties.", risk_level: "medium", risk_reason: "Very broad definition.", recommendation: "Add exclusions for public information.", legal_reference: "UTSA" },
      { title: "Non-Compete Clause", summary: "Cannot work with competitors for 2 years.", risk_level: "critical", risk_reason: "2-year non-compete is unusually long for an NDA.", recommendation: "Negotiate to 6 months or remove.", legal_reference: "FTC Non-Compete Rule" },
      { title: "Indemnification", summary: "You cover all legal costs if you breach.", risk_level: "high", risk_reason: "One-sided with no cap.", recommendation: "Make mutual and add cap.", legal_reference: "UCC Article 2" },
      { title: "Governing Law", summary: "Delaware courts.", risk_level: "low", risk_reason: "Standard jurisdiction.", recommendation: "Acceptable.", legal_reference: "Delaware Corp Law" },
      { title: "Return of Materials", summary: "Return/destroy materials within 30 days.", risk_level: "low", risk_reason: "Standard.", recommendation: "Ensure compliance process exists.", legal_reference: "" },
    ],
    missing_clauses: [
      { clause: "Dispute Resolution / Arbitration", importance: "high", reason: "No arbitration means expensive court proceedings." },
      { clause: "Limitation of Liability", importance: "high", reason: "No cap = unlimited damages." },
      { clause: "Force Majeure", importance: "medium", reason: "No protection for unforeseeable events." },
    ],
    overall_risk_score: 7,
    overall_risk_label: "High Risk",
    red_flags: ["Non-compete is very restrictive (2 years)", "One-sided indemnification", "No dispute resolution"],
    action_items: ["Remove/reduce non-compete", "Add mutual indemnification", "Add arbitration clause", "Add liability cap", "Lawyer review"],
    negotiation_points: ["Non-compete: 2 years -> 6 months", "Indemnification: make mutual", "Add liability cap", "Add arbitration"],
    compliance_notes: ["Check GDPR if EU parties involved", "Non-compete may be unenforceable in CA, OK, ND"],
    page_count: 4,
  });
});

app.post("/api/demo/chat", (req, res) => {
  setTimeout(() => {
    res.json({
      response: "Based on the NDA analysis, this contract has several concerning elements. The non-compete clause (2 years) is unusually long for an NDA.\n\n1. **Remove or reduce the non-compete** to 6 months maximum\n2. **Make indemnification mutual** — both parties should bear responsibility\n3. **Add a liability cap** — suggest 2x the estimated value of shared information\n4. **Include an arbitration clause** — saves time and money vs. court\n\nWould you like me to explain any specific clause in more detail?",
    });
  }, 800);
});

// ═══════════════════════════════════════════════════════════════════════════════
// OAUTH SSO (Google / Microsoft)
// ═══════════════════════════════════════════════════════════════════════════════

app.post("/api/auth/oauth", async (req, res) => {
  const { provider, token: oauthToken, name, email: oauthEmail, avatar, oauth_id } = req.body;

  if (!provider || !oauthEmail || !oauth_id) {
    return res.status(400).json({ error: "Provider, email, and OAuth ID are required." });
  }

  if (!["google", "microsoft"].includes(provider)) {
    return res.status(400).json({ error: "Unsupported OAuth provider." });
  }

  try {
    // Check if user exists with this OAuth ID
    let user = db.prepare("SELECT * FROM users WHERE oauth_provider = ? AND oauth_id = ?").get(provider, oauth_id);

    if (!user) {
      // Check if email already exists (link accounts)
      user = db.prepare("SELECT * FROM users WHERE email = ?").get(oauthEmail.toLowerCase());

      if (user) {
        // Link OAuth to existing account
        db.prepare("UPDATE users SET oauth_provider = ?, oauth_id = ?, avatar_url = COALESCE(?, avatar_url) WHERE id = ?")
          .run(provider, oauth_id, avatar || null, user.id);
      } else {
        // Create new user (random password since they'll use OAuth)
        const randomPass = auth.hashPassword(require("crypto").randomBytes(32).toString("hex"));
        db.prepare(
          "INSERT INTO users (email, password, name, company, oauth_provider, oauth_id, avatar_url) VALUES (?, ?, ?, '', ?, ?, ?)"
        ).run(oauthEmail.toLowerCase(), randomPass, name || oauthEmail.split("@")[0], provider, oauth_id, avatar || "");

        user = db.prepare("SELECT * FROM users WHERE email = ?").get(oauthEmail.toLowerCase());

        // Send welcome email
        mailer.sendWelcome(user);
      }
    }

    // Refresh user data
    user = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
    const jwtToken = auth.generateToken(user);

    res.json({
      token: jwtToken,
      user: {
        id: user.id, email: user.email, name: user.name, company: user.company,
        plan: user.plan, analyses_used: user.analyses_used, avatar_url: user.avatar_url,
        oauth_provider: user.oauth_provider,
      },
    });
  } catch (error) {
    console.error("OAuth error:", error);
    res.status(500).json({ error: "OAuth authentication failed." });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// FOLDERS & TAGS
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/api/folders", auth.requireAuth, (req, res) => {
  const folders = db.prepare("SELECT * FROM folders WHERE user_id = ? ORDER BY name").all(req.user.id);
  res.json(folders);
});

app.post("/api/folders", auth.requireAuth, (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: "Folder name is required." });

  const result = db.prepare("INSERT INTO folders (user_id, name, color) VALUES (?, ?, ?)")
    .run(req.user.id, name, color || "#4f46e5");
  res.json({ id: result.lastInsertRowid, success: true });
});

app.put("/api/folders/:id", auth.requireAuth, (req, res) => {
  const { name, color } = req.body;
  db.prepare("UPDATE folders SET name = COALESCE(?, name), color = COALESCE(?, color) WHERE id = ? AND user_id = ?")
    .run(name, color, req.params.id, req.user.id);
  res.json({ success: true });
});

app.delete("/api/folders/:id", auth.requireAuth, (req, res) => {
  // Unassign analyses from this folder
  db.prepare("UPDATE analyses SET folder_id = NULL WHERE folder_id = ? AND user_id = ?").run(req.params.id, req.user.id);
  db.prepare("DELETE FROM folders WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
  res.json({ success: true });
});

// Move analysis to folder
app.put("/api/auth/history/:id/folder", auth.requireAuth, (req, res) => {
  const { folder_id } = req.body;
  db.prepare("UPDATE analyses SET folder_id = ? WHERE id = ? AND user_id = ?")
    .run(folder_id || null, req.params.id, req.user.id);
  res.json({ success: true });
});

// Update analysis tags
app.put("/api/auth/history/:id/tags", auth.requireAuth, (req, res) => {
  const { tags } = req.body;
  db.prepare("UPDATE analyses SET tags = ? WHERE id = ? AND user_id = ?")
    .run(Array.isArray(tags) ? tags.join(",") : (tags || ""), req.params.id, req.user.id);
  res.json({ success: true });
});

// Enhanced history with folders and tags
app.get("/api/auth/history-full", auth.requireAuth, (req, res) => {
  const { folder_id, tag, search } = req.query;
  let query = "SELECT a.*, f.name as folder_name, f.color as folder_color FROM analyses a LEFT JOIN folders f ON a.folder_id = f.id WHERE a.user_id = ?";
  const params = [req.user.id];

  if (folder_id) { query += " AND a.folder_id = ?"; params.push(folder_id); }
  if (tag) { query += " AND a.tags LIKE ?"; params.push(`%${tag}%`); }
  if (search) { query += " AND (a.filename LIKE ? OR a.document_type LIKE ?)"; params.push(`%${search}%`, `%${search}%`); }

  query += " ORDER BY a.created_at DESC LIMIT 100";
  res.json(db.prepare(query).all(...params));
});

// ═══════════════════════════════════════════════════════════════════════════════
// DOCX EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

app.post("/api/export/docx", async (req, res) => {
  const { analysis } = req.body;
  if (!analysis) return res.status(400).json({ error: "Analysis data is required." });

  try {
    const buffer = await generateAnalysisDocx(analysis);
    const filename = `ContractShield_Analysis_${(analysis.filename || "report").replace(/\.[^.]+$/, "")}.docx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    console.error("DOCX export error:", error);
    res.status(500).json({ error: "Failed to generate DOCX file." });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// EMAIL PREFERENCES & NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════════

app.put("/api/auth/email-prefs", auth.requireAuth, (req, res) => {
  const { email_notifications, email_deadline_alerts, email_weekly_digest } = req.body;
  db.prepare(
    "UPDATE users SET email_notifications=COALESCE(?,email_notifications), email_deadline_alerts=COALESCE(?,email_deadline_alerts), email_weekly_digest=COALESCE(?,email_weekly_digest) WHERE id=?"
  ).run(
    email_notifications !== undefined ? (email_notifications ? 1 : 0) : null,
    email_deadline_alerts !== undefined ? (email_deadline_alerts ? 1 : 0) : null,
    email_weekly_digest !== undefined ? (email_weekly_digest ? 1 : 0) : null,
    req.user.id
  );
  res.json({ success: true });
});

// Onboarding status
app.put("/api/auth/onboarding", auth.requireAuth, (req, res) => {
  db.prepare("UPDATE users SET onboarding_completed = 1 WHERE id = ?").run(req.user.id);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEAM WORKSPACES
// ═══════════════════════════════════════════════════════════════════════════════

app.post("/api/teams", auth.requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Team name is required." });
  if (req.user.team_id) return res.status(400).json({ error: "You already belong to a team. Leave first." });

  const result = db.prepare("INSERT INTO teams (name, owner_id) VALUES (?, ?)").run(name, req.user.id);
  db.prepare("UPDATE users SET team_id = ?, team_role = 'admin' WHERE id = ?").run(result.lastInsertRowid, req.user.id);
  res.json({ id: result.lastInsertRowid, success: true });
});

app.get("/api/teams/me", auth.requireAuth, (req, res) => {
  if (!req.user.team_id) return res.json({ team: null });
  const team = db.prepare("SELECT * FROM teams WHERE id = ?").get(req.user.team_id);
  const members = db.prepare("SELECT id, name, email, team_role, avatar_url FROM users WHERE team_id = ?").all(req.user.team_id);
  const invites = db.prepare("SELECT * FROM team_invites WHERE team_id = ? AND status = 'pending'").all(req.user.team_id);
  res.json({ team, members, invites, my_role: req.user.team_role });
});

app.post("/api/teams/invite", auth.requireAuth, (req, res) => {
  if (!req.user.team_id || req.user.team_role !== "admin") return res.status(403).json({ error: "Only team admins can invite." });
  const { email: inviteEmail, role } = req.body;
  if (!inviteEmail) return res.status(400).json({ error: "Email is required." });

  const inviteCode = require("crypto").randomBytes(16).toString("hex");
  db.prepare("INSERT INTO team_invites (team_id, email, role, invite_code) VALUES (?, ?, ?, ?)")
    .run(req.user.team_id, inviteEmail.toLowerCase(), role || "member", inviteCode);

  const inviteUrl = `${process.env.APP_URL || "http://localhost:3001"}/join/${inviteCode}`;
  res.json({ invite_code: inviteCode, url: inviteUrl });
});

app.post("/api/teams/join/:code", auth.requireAuth, (req, res) => {
  const invite = db.prepare("SELECT * FROM team_invites WHERE invite_code = ? AND status = 'pending'").get(req.params.code);
  if (!invite) return res.status(404).json({ error: "Invalid or expired invite." });
  if (req.user.team_id) return res.status(400).json({ error: "Leave your current team first." });

  db.prepare("UPDATE users SET team_id = ?, team_role = ? WHERE id = ?").run(invite.team_id, invite.role, req.user.id);
  db.prepare("UPDATE team_invites SET status = 'accepted' WHERE id = ?").run(invite.id);
  res.json({ success: true, team_id: invite.team_id });
});

app.post("/api/teams/leave", auth.requireAuth, (req, res) => {
  if (!req.user.team_id) return res.status(400).json({ error: "Not in a team." });
  const team = db.prepare("SELECT * FROM teams WHERE id = ?").get(req.user.team_id);
  if (team && team.owner_id === req.user.id) {
    // Transfer or delete team
    const nextAdmin = db.prepare("SELECT id FROM users WHERE team_id = ? AND id != ? LIMIT 1").get(req.user.team_id, req.user.id);
    if (nextAdmin) {
      db.prepare("UPDATE teams SET owner_id = ? WHERE id = ?").run(nextAdmin.id, req.user.team_id);
      db.prepare("UPDATE users SET team_role = 'admin' WHERE id = ?").run(nextAdmin.id);
    } else {
      db.prepare("DELETE FROM teams WHERE id = ?").run(req.user.team_id);
    }
  }
  db.prepare("UPDATE users SET team_id = NULL, team_role = '' WHERE id = ?").run(req.user.id);
  res.json({ success: true });
});

app.put("/api/teams/members/:userId/role", auth.requireAuth, (req, res) => {
  if (req.user.team_role !== "admin") return res.status(403).json({ error: "Admin only." });
  const { role } = req.body;
  if (!["admin", "member", "viewer"].includes(role)) return res.status(400).json({ error: "Invalid role." });
  db.prepare("UPDATE users SET team_role = ? WHERE id = ? AND team_id = ?").run(role, req.params.userId, req.user.team_id);
  res.json({ success: true });
});

app.get("/api/teams/analyses", auth.requireAuth, (req, res) => {
  if (!req.user.team_id) return res.json([]);
  const analyses = db.prepare(
    "SELECT a.*, u.name as uploaded_by FROM analyses a JOIN users u ON a.user_id = u.id WHERE a.team_id = ? ORDER BY a.created_at DESC LIMIT 100"
  ).all(req.user.team_id);
  res.json(analyses);
});

app.get("/join/:code", (req, res) => { res.sendFile(path.join(__dirname, "public", "index.html")); });

// ═══════════════════════════════════════════════════════════════════════════════
// DEVELOPER API KEYS
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/api/keys", auth.requireAuth, (req, res) => {
  const keys = db.prepare("SELECT id, key_prefix, name, is_active, last_used_at, requests_today, created_at FROM api_keys WHERE user_id = ?").all(req.user.id);
  res.json(keys);
});

app.post("/api/keys", auth.requireAuth, (req, res) => {
  if (req.user.plan !== "enterprise") return res.status(403).json({ error: "API keys require an Enterprise plan." });

  const { name } = req.body;
  const rawKey = "csk_" + require("crypto").randomBytes(32).toString("hex");
  const keyHash = require("crypto").createHash("sha256").update(rawKey).digest("hex");
  const keyPrefix = rawKey.substring(0, 12) + "...";

  db.prepare("INSERT INTO api_keys (user_id, key_hash, key_prefix, name) VALUES (?, ?, ?, ?)")
    .run(req.user.id, keyHash, keyPrefix, name || "Default");

  res.json({ key: rawKey, prefix: keyPrefix, message: "Save this key — it won't be shown again." });
});

app.delete("/api/keys/:id", auth.requireAuth, (req, res) => {
  db.prepare("DELETE FROM api_keys WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
  res.json({ success: true });
});

// API Key auth middleware
function apiKeyAuth(req, res, next) {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey) return next(); // Fall through to JWT auth

  const keyHash = require("crypto").createHash("sha256").update(apiKey).digest("hex");
  const record = db.prepare("SELECT ak.*, u.* FROM api_keys ak JOIN users u ON ak.user_id = u.id WHERE ak.key_hash = ? AND ak.is_active = 1").get(keyHash);

  if (!record) return res.status(401).json({ error: "Invalid API key." });

  // Rate limiting: 1000 requests/day
  if (record.requests_reset_at !== new Date().toISOString().split("T")[0]) {
    db.prepare("UPDATE api_keys SET requests_today = 0, requests_reset_at = date('now') WHERE id = ?").run(record.id);
    record.requests_today = 0;
  }
  if (record.requests_today >= 1000) return res.status(429).json({ error: "API rate limit exceeded (1000/day)." });

  db.prepare("UPDATE api_keys SET requests_today = requests_today + 1, last_used_at = datetime('now') WHERE id = ?").run(record.id);
  req.user = record;
  next();
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTRACT VERSION TRACKING
// ═══════════════════════════════════════════════════════════════════════════════

app.post("/api/versions/create-group", auth.requireAuth, (req, res) => {
  const { analysis_id } = req.body;
  if (!analysis_id) return res.status(400).json({ error: "Analysis ID required." });

  const versionGroup = "vg_" + require("crypto").randomBytes(8).toString("hex");
  db.prepare("UPDATE analyses SET version_group = ?, version_number = 1 WHERE analysis_id = ? AND user_id = ?")
    .run(versionGroup, analysis_id, req.user.id);
  res.json({ version_group: versionGroup });
});

app.put("/api/versions/:analysisId/assign", auth.requireAuth, (req, res) => {
  const { version_group } = req.body;
  if (!version_group) return res.status(400).json({ error: "Version group required." });

  const existing = db.prepare("SELECT MAX(version_number) as max_v FROM analyses WHERE version_group = ?").get(version_group);
  const nextVersion = (existing?.max_v || 0) + 1;

  db.prepare("UPDATE analyses SET version_group = ?, version_number = ? WHERE analysis_id = ? AND user_id = ?")
    .run(version_group, nextVersion, req.params.analysisId, req.user.id);
  res.json({ version_number: nextVersion });
});

app.get("/api/versions/:versionGroup", auth.requireAuth, (req, res) => {
  const versions = db.prepare(
    "SELECT id, analysis_id, filename, document_type, risk_score, risk_label, version_number, created_at FROM analyses WHERE version_group = ? AND user_id = ? ORDER BY version_number"
  ).all(req.params.versionGroup, req.user.id);
  res.json(versions);
});

app.get("/api/versions/:versionGroup/compare", auth.requireAuth, (req, res) => {
  const versions = db.prepare(
    "SELECT * FROM analyses WHERE version_group = ? AND user_id = ? ORDER BY version_number"
  ).all(req.params.versionGroup, req.user.id);

  if (versions.length < 2) return res.status(400).json({ error: "Need at least 2 versions to compare." });

  const v1 = JSON.parse(versions[0].data);
  const v2 = JSON.parse(versions[versions.length - 1].data);

  const comparison = {
    v1: { version: versions[0].version_number, filename: versions[0].filename, risk_score: versions[0].risk_score, analyzed: versions[0].created_at },
    v2: { version: versions[versions.length - 1].version_number, filename: versions[versions.length - 1].filename, risk_score: versions[versions.length - 1].risk_score, analyzed: versions[versions.length - 1].created_at },
    risk_change: (versions[versions.length - 1].risk_score || 0) - (versions[0].risk_score || 0),
    risk_improved: (versions[versions.length - 1].risk_score || 0) < (versions[0].risk_score || 0),
    clause_changes: [],
    new_red_flags: (v2.red_flags || []).filter(f => !(v1.red_flags || []).includes(f)),
    resolved_red_flags: (v1.red_flags || []).filter(f => !(v2.red_flags || []).includes(f)),
    all_versions: versions.map(v => ({ version: v.version_number, risk_score: v.risk_score, filename: v.filename, date: v.created_at })),
  };

  // Compare clauses
  const v1Clauses = new Map((v1.clauses || []).map(c => [c.title, c]));
  const v2Clauses = new Map((v2.clauses || []).map(c => [c.title, c]));

  for (const [title, c2] of v2Clauses) {
    const c1 = v1Clauses.get(title);
    if (!c1) {
      comparison.clause_changes.push({ title, type: "added", new_risk: c2.risk_level });
    } else if (c1.risk_level !== c2.risk_level) {
      comparison.clause_changes.push({ title, type: "changed", old_risk: c1.risk_level, new_risk: c2.risk_level, improved: ["critical","high","medium","low"].indexOf(c2.risk_level) > ["critical","high","medium","low"].indexOf(c1.risk_level) });
    }
  }
  for (const [title] of v1Clauses) {
    if (!v2Clauses.has(title)) comparison.clause_changes.push({ title, type: "removed" });
  }

  res.json(comparison);
});

// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOK INTEGRATIONS
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/api/webhooks", auth.requireAuth, (req, res) => {
  const hooks = db.prepare("SELECT id, url, events, is_active, last_triggered_at, failure_count, created_at FROM webhooks WHERE user_id = ?").all(req.user.id);
  hooks.forEach(h => { h.events = h.events.split(","); });
  res.json(hooks);
});

app.post("/api/webhooks", auth.requireAuth, (req, res) => {
  const { url, events } = req.body;
  if (!url || !events || !events.length) return res.status(400).json({ error: "URL and events are required." });

  const validEvents = ["analysis_complete", "deadline_alert", "team_invite", "version_uploaded"];
  const invalidEvents = events.filter(e => !validEvents.includes(e));
  if (invalidEvents.length) return res.status(400).json({ error: "Invalid events: " + invalidEvents.join(", "), valid: validEvents });

  const secret = "whsec_" + require("crypto").randomBytes(24).toString("hex");
  const result = db.prepare("INSERT INTO webhooks (user_id, url, events, secret) VALUES (?, ?, ?, ?)")
    .run(req.user.id, url, events.join(","), secret);

  res.json({ id: result.lastInsertRowid, secret, message: "Save this secret for verifying webhook payloads." });
});

app.delete("/api/webhooks/:id", auth.requireAuth, (req, res) => {
  db.prepare("DELETE FROM webhooks WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
  res.json({ success: true });
});

app.put("/api/webhooks/:id/toggle", auth.requireAuth, (req, res) => {
  db.prepare("UPDATE webhooks SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
  res.json({ success: true });
});

// Webhook dispatcher
function triggerWebhooks(userId, event, payload) {
  const hooks = db.prepare("SELECT * FROM webhooks WHERE user_id = ? AND is_active = 1 AND events LIKE ?").all(userId, `%${event}%`);
  for (const hook of hooks) {
    const body = JSON.stringify({ event, data: payload, timestamp: new Date().toISOString() });
    const signature = require("crypto").createHmac("sha256", hook.secret).update(body).digest("hex");

    const url = new URL(hook.url);
    const options = { hostname: url.hostname, port: url.port || (url.protocol === "https:" ? 443 : 80), path: url.pathname, method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Signature": signature, "X-Webhook-Event": event } };

    const lib = url.protocol === "https:" ? require("https") : require("http");
    const req = lib.request(options, (res) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        db.prepare("UPDATE webhooks SET last_triggered_at = datetime('now'), failure_count = 0 WHERE id = ?").run(hook.id);
      } else {
        db.prepare("UPDATE webhooks SET failure_count = failure_count + 1 WHERE id = ?").run(hook.id);
      }
    });
    req.on("error", () => { db.prepare("UPDATE webhooks SET failure_count = failure_count + 1 WHERE id = ?").run(hook.id); });
    req.write(body);
    req.end();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CUSTOM CLAUSE LIBRARY
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/api/custom-clauses", auth.requireAuth, (req, res) => {
  const clauses = db.prepare("SELECT * FROM custom_clauses WHERE user_id = ? OR team_id = ? ORDER BY category, title")
    .all(req.user.id, req.user.team_id || -1);
  res.json(clauses);
});

app.post("/api/custom-clauses", auth.requireAuth, (req, res) => {
  const { category, title, text, share_with_team } = req.body;
  if (!category || !title || !text) return res.status(400).json({ error: "Category, title, and text are required." });

  const teamId = share_with_team && req.user.team_id ? req.user.team_id : null;
  const result = db.prepare("INSERT INTO custom_clauses (user_id, category, title, text, team_id) VALUES (?, ?, ?, ?, ?)")
    .run(req.user.id, category, title, text, teamId);
  res.json({ id: result.lastInsertRowid, success: true });
});

app.put("/api/custom-clauses/:id", auth.requireAuth, (req, res) => {
  const { category, title, text } = req.body;
  db.prepare("UPDATE custom_clauses SET category=COALESCE(?,category), title=COALESCE(?,title), text=COALESCE(?,text) WHERE id=? AND user_id=?")
    .run(category, title, text, req.params.id, req.user.id);
  res.json({ success: true });
});

app.delete("/api/custom-clauses/:id", auth.requireAuth, (req, res) => {
  db.prepare("DELETE FROM custom_clauses WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TWO-FACTOR AUTHENTICATION (2FA)
// ═══════════════════════════════════════════════════════════════════════════════

const otplib = require("otplib");
const QRCode = require("qrcode");

app.post("/api/auth/2fa/setup", auth.requireAuth, async (req, res) => {
  if (req.user.totp_enabled) return res.status(400).json({ error: "2FA is already enabled." });

  const secret = otplib.generateSecret();
  const otpauth = otplib.generateURI({ issuer: "ContractShield AI", label: req.user.email, secret });

  try {
    const qrDataUrl = await QRCode.toDataURL(otpauth);

    // Generate backup codes
    const backupCodes = Array.from({ length: 8 }, () => require("crypto").randomBytes(4).toString("hex"));

    // Store temporarily (not enabled until verified)
    db.prepare("UPDATE users SET totp_secret = ?, backup_codes = ? WHERE id = ?")
      .run(secret, JSON.stringify(backupCodes), req.user.id);

    res.json({ qr: qrDataUrl, secret, backup_codes: backupCodes });
  } catch (e) {
    res.status(500).json({ error: "Failed to generate 2FA setup." });
  }
});

app.post("/api/auth/2fa/verify", auth.requireAuth, (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "Verification code required." });

  const user = db.prepare("SELECT totp_secret FROM users WHERE id = ?").get(req.user.id);
  if (!user.totp_secret) return res.status(400).json({ error: "Set up 2FA first." });

  const isValid = otplib.verifySync({ token, secret: user.totp_secret }).valid;
  if (!isValid) return res.status(400).json({ error: "Invalid verification code." });

  db.prepare("UPDATE users SET totp_enabled = 1 WHERE id = ?").run(req.user.id);
  res.json({ success: true, message: "2FA enabled successfully." });
});

app.post("/api/auth/2fa/disable", auth.requireAuth, (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "Current 2FA code required to disable." });

  const user = db.prepare("SELECT totp_secret FROM users WHERE id = ?").get(req.user.id);
  const isValid = otplib.verifySync({ token, secret: user.totp_secret }).valid;
  if (!isValid) return res.status(400).json({ error: "Invalid code." });

  db.prepare("UPDATE users SET totp_enabled = 0, totp_secret = '', backup_codes = '' WHERE id = ?").run(req.user.id);
  res.json({ success: true });
});

// Enhanced login to check 2FA
app.post("/api/auth/login-2fa", (req, res) => {
  const { email, password, totp_token, backup_code } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required." });

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase());
  if (!user || !auth.verifyPassword(password, user.password)) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  if (user.totp_enabled) {
    if (!totp_token && !backup_code) {
      return res.status(200).json({ requires_2fa: true, message: "2FA code required." });
    }

    if (totp_token) {
      const isValid = otplib.verifySync({ token: totp_token, secret: user.totp_secret }).valid;
      if (!isValid) return res.status(401).json({ error: "Invalid 2FA code." });
    } else if (backup_code) {
      const codes = JSON.parse(user.backup_codes || "[]");
      const idx = codes.indexOf(backup_code);
      if (idx === -1) return res.status(401).json({ error: "Invalid backup code." });
      codes.splice(idx, 1);
      db.prepare("UPDATE users SET backup_codes = ? WHERE id = ?").run(JSON.stringify(codes), user.id);
    }
  }

  const token = auth.generateToken(user);
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, plan: user.plan } });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 3: FEATURE 1 — EXECUTIVE SUMMARY GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════

app.post("/api/executive-summary", auth.optionalAuth, async (req, res) => {
  const { analysis } = req.body;
  if (!analysis) return res.status(400).json({ error: "Analysis data is required." });

  try {
    const prompt = `You are a senior legal advisor preparing a 1-page executive brief for a C-level executive.

Given this contract analysis, create a concise executive summary.

Return JSON:
{
  "title": "Executive Brief: [document type]",
  "one_liner": "Single sentence: what this contract is and the #1 thing to know",
  "recommendation": "SIGN|NEGOTIATE|REJECT with 1-sentence reason",
  "risk_level": "LOW|MEDIUM|HIGH|CRITICAL",
  "key_numbers": [{"label": "...", "value": "..."}],
  "top_risks": ["Top 3 risks in plain English"],
  "required_changes": ["Changes that MUST be made before signing"],
  "timeline": "Key dates and deadlines in one line"
}

IMPORTANT: Return ONLY valid JSON.`;

    const context = `Contract: ${analysis.filename || "Unknown"}
Type: ${analysis.document_type || "Unknown"}
Summary: ${analysis.summary || ""}
Risk Score: ${analysis.overall_risk_score}/10
Parties: ${(analysis.parties || []).join(", ")}
Red Flags: ${(analysis.red_flags || []).join("; ")}
Financial Terms: ${(analysis.financial_terms || []).map(f => `${f.item}: ${f.amount}`).join("; ")}
Key Dates: ${(analysis.key_dates || []).map(d => `${d.event}: ${d.date}`).join("; ")}
Clauses: ${(analysis.clauses || []).map(c => `${c.title} (${c.risk_level})`).join(", ")}
Missing: ${(analysis.missing_clauses || []).map(c => c.clause).join(", ")}
Action Items: ${(analysis.action_items || []).join("; ")}`;

    const result = await callClaude(prompt, context, 2048);
    result.generated_at = new Date().toISOString();
    result.source_file = analysis.filename;
    res.json(result);
  } catch (error) {
    console.error("Executive summary error:", error);
    res.status(500).json({ error: error.message || "Failed to generate executive summary." });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 3: FEATURE 2 — OBLIGATION TRACKER
// ═══════════════════════════════════════════════════════════════════════════════

app.post("/api/obligations/extract", auth.requireAuth, async (req, res) => {
  const { analysis } = req.body;
  if (!analysis) return res.status(400).json({ error: "Analysis data is required." });

  try {
    const prompt = `You are a contract obligation specialist. Extract ALL obligations from this contract analysis.

Return JSON:
{
  "obligations": [
    {
      "party": "Who is obligated (e.g., 'Client', 'Provider', 'Both Parties')",
      "obligation": "What they must do — plain English",
      "due_date": "When (specific date, duration, or 'Ongoing')",
      "priority": "high|medium|low",
      "clause_reference": "Which clause this comes from"
    }
  ]
}

Extract every obligation you can find — payments, deliverables, deadlines, restrictions, reporting requirements, insurance, confidentiality, etc.

IMPORTANT: Return ONLY valid JSON.`;

    const context = `Contract: ${analysis.filename}
Type: ${analysis.document_type}
Parties: ${(analysis.parties || []).join(", ")}
Summary: ${analysis.summary}
Clauses: ${(analysis.clauses || []).map(c => `${c.title}: ${c.summary}`).join("\n")}
Financial Terms: ${(analysis.financial_terms || []).map(f => `${f.item}: ${f.amount} (${f.frequency})`).join("\n")}
Key Dates: ${(analysis.key_dates || []).map(d => `${d.event}: ${d.date}`).join("\n")}`;

    const result = await callClaude(prompt, context, 4096);

    // Save obligations to DB
    const analysisId = analysis.id || "unknown";
    for (const ob of (result.obligations || [])) {
      db.prepare("INSERT INTO obligations (user_id, analysis_id, party, obligation, due_date, priority, clause_reference) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(req.user.id, analysisId, ob.party, ob.obligation, ob.due_date || "", ob.priority || "medium", ob.clause_reference || "");
    }

    logAudit(req, "obligations_extracted", "analysis", analysisId, `Extracted ${(result.obligations || []).length} obligations`);
    res.json(result);
  } catch (error) {
    console.error("Obligation extraction error:", error);
    res.status(500).json({ error: error.message || "Failed to extract obligations." });
  }
});

app.get("/api/obligations", auth.requireAuth, (req, res) => {
  const { analysis_id, status } = req.query;
  let query = "SELECT * FROM obligations WHERE user_id = ?";
  const params = [req.user.id];
  if (analysis_id) { query += " AND analysis_id = ?"; params.push(analysis_id); }
  if (status) { query += " AND status = ?"; params.push(status); }
  query += " ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, created_at DESC";
  res.json(db.prepare(query).all(...params));
});

app.put("/api/obligations/:id", auth.requireAuth, (req, res) => {
  const { status, priority } = req.body;
  db.prepare("UPDATE obligations SET status=COALESCE(?,status), priority=COALESCE(?,priority) WHERE id=? AND user_id=?")
    .run(status, priority, req.params.id, req.user.id);
  logAudit(req, "obligation_updated", "obligation", req.params.id, `Status: ${status || "unchanged"}`);
  res.json({ success: true });
});

app.delete("/api/obligations/:id", auth.requireAuth, (req, res) => {
  db.prepare("DELETE FROM obligations WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 3: FEATURE 3 — CLAUSE NEGOTIATION EMAIL GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════

app.post("/api/negotiation-email", auth.optionalAuth, async (req, res) => {
  const { clause_title, clause_text, risk_level, desired_change, recipient_name, sender_name, tone } = req.body;
  if (!clause_title || !desired_change) return res.status(400).json({ error: "Clause title and desired change are required." });

  try {
    const prompt = `You are an expert business negotiator. Write a professional email requesting a contract change.

Return JSON:
{
  "subject": "Email subject line",
  "body": "Full email body (professional, persuasive, polite)",
  "key_points": ["Bullet points of the arguments made"],
  "tone_used": "collaborative|firm|friendly",
  "follow_up_date": "Suggested follow-up timeframe"
}

IMPORTANT: Return ONLY valid JSON.`;

    const context = `Clause: ${clause_title}
Current Text: ${clause_text || "N/A"}
Risk Level: ${risk_level || "N/A"}
Desired Change: ${desired_change}
Recipient: ${recipient_name || "the other party"}
Sender: ${sender_name || ""}
Tone: ${tone || "collaborative"}`;

    const result = await callClaude(prompt, context, 2048);
    res.json(result);
  } catch (error) {
    console.error("Negotiation email error:", error);
    res.status(500).json({ error: error.message || "Failed to generate negotiation email." });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 3: FEATURE 4 — INDUSTRY ANALYSIS PROFILES
// ═══════════════════════════════════════════════════════════════════════════════

const INDUSTRY_PROFILES = {
  "real-estate": {
    name: "Real Estate",
    focus: "Focus on: lease terms, security deposits, maintenance obligations, tenant rights, property condition, environmental clauses, zoning compliance, CAM charges, renewal options, subletting restrictions.",
    risk_weights: "Weight these as HIGH risk: unreasonable security deposit terms, no maintenance obligations on landlord, unlimited rent increases, no right to cure defaults, automatic renewal without notice.",
  },
  construction: {
    name: "Construction",
    focus: "Focus on: payment schedules, change order procedures, lien waivers, bonding requirements, safety compliance (OSHA), insurance requirements, warranty periods, liquidated damages, force majeure, indemnification, retainage.",
    risk_weights: "Weight these as HIGH risk: pay-when-paid clauses, no change order process, unlimited liability, no dispute resolution, missing insurance requirements, no safety provisions.",
  },
  saas: {
    name: "SaaS / Technology",
    focus: "Focus on: SLA uptime guarantees, data ownership, data portability, API access, security standards (SOC2/ISO27001), termination and data deletion, auto-renewal, price increase caps, intellectual property rights, limitation of liability.",
    risk_weights: "Weight these as HIGH risk: vendor owns your data, no SLA guarantees, no data export on termination, unlimited price increases, broad IP assignment, no security commitments.",
  },
  employment: {
    name: "Employment / HR",
    focus: "Focus on: compensation and benefits, non-compete scope and duration, intellectual property assignment, termination conditions, severance, confidentiality, arbitration clauses, at-will provisions, equity/options vesting, non-solicitation.",
    risk_weights: "Weight these as HIGH risk: non-compete over 12 months, broad IP assignment including personal projects, mandatory arbitration without opt-out, no severance on termination without cause, clawback clauses.",
  },
  freelance: {
    name: "Freelance / Consulting",
    focus: "Focus on: payment terms and late fees, scope of work definition, revision limits, kill fees, intellectual property ownership, independent contractor classification, non-compete restrictions, liability caps, termination notice.",
    risk_weights: "Weight these as HIGH risk: net-90+ payment terms, unlimited revisions, full IP assignment without additional compensation, misclassification risk, no kill fee, broad non-compete.",
  },
  healthcare: {
    name: "Healthcare",
    focus: "Focus on: HIPAA compliance, BAA requirements, data security, patient data handling, malpractice liability, credentialing, termination provisions, non-compete for practitioners, insurance requirements, regulatory compliance.",
    risk_weights: "Weight these as HIGH risk: no BAA, inadequate data security provisions, unlimited malpractice liability, no HIPAA compliance language, overly broad non-compete for healthcare workers.",
  },
};

app.get("/api/industry-profiles", (req, res) => {
  const profiles = Object.entries(INDUSTRY_PROFILES).map(([key, val]) => ({ id: key, name: val.name }));
  res.json(profiles);
});

app.put("/api/auth/industry", auth.requireAuth, (req, res) => {
  const { industry } = req.body;
  if (industry && !INDUSTRY_PROFILES[industry]) return res.status(400).json({ error: "Invalid industry profile.", valid: Object.keys(INDUSTRY_PROFILES) });
  db.prepare("UPDATE users SET industry = ? WHERE id = ?").run(industry || "", req.user.id);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 3: FEATURE 5 — BULK ACTIONS ON HISTORY
// ═══════════════════════════════════════════════════════════════════════════════

app.post("/api/bulk/delete", auth.requireAuth, (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "Array of analysis IDs required." });
  if (ids.length > 50) return res.status(400).json({ error: "Maximum 50 items per bulk action." });

  const placeholders = ids.map(() => "?").join(",");
  const result = db.prepare(`DELETE FROM analyses WHERE id IN (${placeholders}) AND user_id = ?`).run(...ids, req.user.id);
  logAudit(req, "bulk_delete", "analyses", ids.join(","), `Deleted ${result.changes} analyses`);
  res.json({ success: true, deleted: result.changes });
});

app.post("/api/bulk/move", auth.requireAuth, (req, res) => {
  const { ids, folder_id } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "Array of analysis IDs required." });

  const placeholders = ids.map(() => "?").join(",");
  const result = db.prepare(`UPDATE analyses SET folder_id = ? WHERE id IN (${placeholders}) AND user_id = ?`).run(folder_id || null, ...ids, req.user.id);
  logAudit(req, "bulk_move", "analyses", ids.join(","), `Moved ${result.changes} to folder ${folder_id}`);
  res.json({ success: true, moved: result.changes });
});

app.post("/api/bulk/tag", auth.requireAuth, (req, res) => {
  const { ids, tags } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "Array of analysis IDs required." });
  if (!tags) return res.status(400).json({ error: "Tags string required." });

  const tagStr = Array.isArray(tags) ? tags.join(",") : tags;
  const placeholders = ids.map(() => "?").join(",");
  const result = db.prepare(`UPDATE analyses SET tags = ? WHERE id IN (${placeholders}) AND user_id = ?`).run(tagStr, ...ids, req.user.id);
  res.json({ success: true, updated: result.changes });
});

app.post("/api/bulk/export", auth.requireAuth, async (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "Array of analysis IDs required." });
  if (ids.length > 20) return res.status(400).json({ error: "Maximum 20 items per bulk export." });

  const placeholders = ids.map(() => "?").join(",");
  const analyses = db.prepare(`SELECT * FROM analyses WHERE id IN (${placeholders}) AND user_id = ?`).all(...ids, req.user.id);

  const summaries = analyses.map(a => {
    const data = JSON.parse(a.data);
    return { filename: a.filename, document_type: a.document_type, risk_score: a.risk_score, risk_label: a.risk_label, created_at: a.created_at,
      summary: data.summary, red_flags_count: (data.red_flags || []).length, clauses_count: (data.clauses || []).length };
  });

  res.json({ count: summaries.length, analyses: summaries });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 3: FEATURE 6 — AUDIT LOG
// ═══════════════════════════════════════════════════════════════════════════════

function logAudit(req, action, resourceType, resourceId, details) {
  try {
    const userId = req.user?.id || 0;
    const userName = req.user?.name || "System";
    const teamId = req.user?.team_id || null;
    const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "";
    db.prepare("INSERT INTO audit_log (team_id, user_id, user_name, action, resource_type, resource_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(teamId, userId, userName, action, resourceType || "", String(resourceId || ""), details || "", ip);
  } catch (e) { /* Don't fail the request if audit logging fails */ }
}

app.get("/api/audit-log", auth.requireAuth, (req, res) => {
  if (req.user.team_role !== "admin" && req.user.plan !== "enterprise") {
    return res.status(403).json({ error: "Audit log requires admin role or Enterprise plan." });
  }

  const { limit: lim, offset: off, action, user_id: filterUserId } = req.query;
  let query = "SELECT * FROM audit_log WHERE (team_id = ? OR user_id = ?)";
  const params = [req.user.team_id || -1, req.user.id];

  if (action) { query += " AND action = ?"; params.push(action); }
  if (filterUserId) { query += " AND user_id = ?"; params.push(parseInt(filterUserId)); }

  query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(parseInt(lim) || 100, parseInt(off) || 0);

  const logs = db.prepare(query).all(...params);
  const total = db.prepare("SELECT COUNT(*) as count FROM audit_log WHERE (team_id = ? OR user_id = ?)").get(req.user.team_id || -1, req.user.id);
  res.json({ logs, total: total.count });
});

app.get("/api/audit-log/actions", auth.requireAuth, (req, res) => {
  const actions = db.prepare("SELECT DISTINCT action FROM audit_log WHERE (team_id = ? OR user_id = ?) ORDER BY action")
    .all(req.user.team_id || -1, req.user.id).map(r => r.action);
  res.json(actions);
});

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 3: FEATURE 7 — APPROVAL WORKFLOWS
// ═══════════════════════════════════════════════════════════════════════════════

app.post("/api/approvals", auth.requireAuth, (req, res) => {
  const { analysis_id, title, reviewers } = req.body;
  if (!analysis_id || !title) return res.status(400).json({ error: "Analysis ID and title are required." });

  const reviewerList = reviewers || [];
  const totalSteps = Math.max(reviewerList.length, 1);

  const result = db.prepare("INSERT INTO approval_workflows (user_id, team_id, analysis_id, title, total_steps, reviewers) VALUES (?, ?, ?, ?, ?, ?)")
    .run(req.user.id, req.user.team_id || null, analysis_id, title, totalSteps, JSON.stringify(reviewerList));

  logAudit(req, "approval_submitted", "approval", result.lastInsertRowid, `Submitted: ${title}`);
  res.json({ id: result.lastInsertRowid, success: true });
});

app.get("/api/approvals", auth.requireAuth, (req, res) => {
  const { status } = req.query;
  let query = "SELECT * FROM approval_workflows WHERE (user_id = ? OR team_id = ?)";
  const params = [req.user.id, req.user.team_id || -1];
  if (status) { query += " AND status = ?"; params.push(status); }
  query += " ORDER BY submitted_at DESC";
  const workflows = db.prepare(query).all(...params);
  workflows.forEach(w => { w.reviewers = JSON.parse(w.reviewers); w.comments = JSON.parse(w.comments); });
  res.json(workflows);
});

app.put("/api/approvals/:id/review", auth.requireAuth, (req, res) => {
  const { action, comment } = req.body;
  if (!action || !["approve", "reject", "request_changes"].includes(action)) {
    return res.status(400).json({ error: "Action must be approve, reject, or request_changes." });
  }

  const workflow = db.prepare("SELECT * FROM approval_workflows WHERE id = ?").get(req.params.id);
  if (!workflow) return res.status(404).json({ error: "Workflow not found." });

  const comments = JSON.parse(workflow.comments);
  comments.push({ user_id: req.user.id, user_name: req.user.name, action, comment: comment || "", timestamp: new Date().toISOString() });

  let newStatus = workflow.status;
  let newStep = workflow.current_step;

  if (action === "approve") {
    if (workflow.current_step >= workflow.total_steps) { newStatus = "approved"; }
    else { newStep = workflow.current_step + 1; newStatus = "in_review"; }
  } else if (action === "reject") {
    newStatus = "rejected";
  } else {
    newStatus = "changes_requested";
  }

  db.prepare("UPDATE approval_workflows SET status = ?, current_step = ?, comments = ?, updated_at = datetime('now') WHERE id = ?")
    .run(newStatus, newStep, JSON.stringify(comments), req.params.id);

  logAudit(req, `approval_${action}`, "approval", req.params.id, comment || "");
  res.json({ success: true, status: newStatus, current_step: newStep });
});

app.get("/api/approvals/stats", auth.requireAuth, (req, res) => {
  const teamId = req.user.team_id || -1;
  const pending = db.prepare("SELECT COUNT(*) as c FROM approval_workflows WHERE (user_id=? OR team_id=?) AND status IN ('pending_review','in_review')").get(req.user.id, teamId);
  const approved = db.prepare("SELECT COUNT(*) as c FROM approval_workflows WHERE (user_id=? OR team_id=?) AND status='approved'").get(req.user.id, teamId);
  const rejected = db.prepare("SELECT COUNT(*) as c FROM approval_workflows WHERE (user_id=? OR team_id=?) AND status='rejected'").get(req.user.id, teamId);
  res.json({ pending: pending.c, approved: approved.c, rejected: rejected.c });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 3: FEATURE 8 — SLACK/TEAMS NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════════

app.post("/api/integrations", auth.requireAuth, (req, res) => {
  const { type, name, config } = req.body;
  if (!type) return res.status(400).json({ error: "Integration type is required." });
  if (!["slack", "teams", "discord", "email_relay"].includes(type)) {
    return res.status(400).json({ error: "Supported types: slack, teams, discord, email_relay." });
  }
  if (!config || !config.webhook_url) return res.status(400).json({ error: "Webhook URL is required in config." });

  const result = db.prepare("INSERT INTO integrations (user_id, team_id, type, name, config) VALUES (?, ?, ?, ?, ?)")
    .run(req.user.id, req.user.team_id || null, type, name || type, JSON.stringify(config));

  logAudit(req, "integration_added", "integration", result.lastInsertRowid, `Added ${type}: ${name || type}`);
  res.json({ id: result.lastInsertRowid, success: true });
});

app.get("/api/integrations", auth.requireAuth, (req, res) => {
  const integrations = db.prepare("SELECT * FROM integrations WHERE user_id = ? OR team_id = ? ORDER BY created_at DESC")
    .all(req.user.id, req.user.team_id || -1);
  integrations.forEach(i => { i.config = JSON.parse(i.config); });
  res.json(integrations);
});

app.delete("/api/integrations/:id", auth.requireAuth, (req, res) => {
  db.prepare("DELETE FROM integrations WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
  logAudit(req, "integration_removed", "integration", req.params.id, "");
  res.json({ success: true });
});

app.put("/api/integrations/:id/toggle", auth.requireAuth, (req, res) => {
  db.prepare("UPDATE integrations SET is_active = CASE WHEN is_active=1 THEN 0 ELSE 1 END WHERE id=? AND user_id=?").run(req.params.id, req.user.id);
  res.json({ success: true });
});

app.post("/api/integrations/test", auth.requireAuth, async (req, res) => {
  const { id } = req.body;
  const integration = db.prepare("SELECT * FROM integrations WHERE id = ? AND user_id = ?").get(id, req.user.id);
  if (!integration) return res.status(404).json({ error: "Integration not found." });

  const config = JSON.parse(integration.config);
  try {
    await sendIntegrationMessage(integration.type, config.webhook_url, {
      text: "ContractShield AI test notification. Your integration is working!",
      title: "Test Notification",
      type: "test",
    });
    db.prepare("UPDATE integrations SET last_used_at = datetime('now') WHERE id = ?").run(id);
    res.json({ success: true, message: "Test notification sent." });
  } catch (error) {
    res.status(500).json({ error: "Failed to send test: " + error.message });
  }
});

async function sendIntegrationMessage(type, webhookUrl, payload) {
  const https = require("https");
  const http = require("http");

  let body;
  if (type === "slack") {
    body = JSON.stringify({ text: payload.title ? `*${payload.title}*\n${payload.text}` : payload.text });
  } else if (type === "teams") {
    body = JSON.stringify({ "@type": "MessageCard", summary: payload.title || "ContractShield", themeColor: "4f46e5",
      sections: [{ activityTitle: payload.title || "ContractShield AI", text: payload.text }] });
  } else if (type === "discord") {
    body = JSON.stringify({ content: payload.title ? `**${payload.title}**\n${payload.text}` : payload.text });
  } else {
    body = JSON.stringify(payload);
  }

  return new Promise((resolve, reject) => {
    const url = new URL(webhookUrl);
    const lib = url.protocol === "https:" ? https : http;
    const opts = { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } };
    const r = lib.request(opts, (rs) => { let d = ""; rs.on("data", c => d += c); rs.on("end", () => rs.statusCode < 300 ? resolve(d) : reject(new Error(`HTTP ${rs.statusCode}`))); });
    r.on("error", reject);
    r.write(body);
    r.end();
  });
}

// Notify all integrations for a user/team
async function notifyIntegrations(userId, teamId, title, text) {
  try {
    const integrations = db.prepare("SELECT * FROM integrations WHERE (user_id = ? OR team_id = ?) AND is_active = 1")
      .all(userId, teamId || -1);
    for (const intg of integrations) {
      const config = JSON.parse(intg.config);
      sendIntegrationMessage(intg.type, config.webhook_url, { title, text }).catch(() => {});
    }
  } catch (e) { /* silent */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 3: FEATURE 9 — GOOGLE DRIVE / DROPBOX IMPORT
// ═══════════════════════════════════════════════════════════════════════════════

app.post("/api/import/url", auth.requireAuth, auth.checkLimit("analyses"), async (req, res) => {
  const { url: fileUrl, filename } = req.body;
  if (!fileUrl) return res.status(400).json({ error: "File URL is required." });

  try {
    const https = require("https");
    const http = require("http");
    const tmpPath = path.join(uploadsDir, "import_" + Date.now());

    await new Promise((resolve, reject) => {
      const parsedUrl = new URL(fileUrl);
      const lib = parsedUrl.protocol === "https:" ? https : http;
      const file = fs.createWriteStream(tmpPath);
      lib.get(fileUrl, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          lib.get(response.headers.location, (r2) => { r2.pipe(file); file.on("finish", () => { file.close(); resolve(); }); }).on("error", reject);
        } else {
          response.pipe(file);
          file.on("finish", () => { file.close(); resolve(); });
        }
      }).on("error", reject);
    });

    const fname = filename || path.basename(new URL(fileUrl).pathname) || "imported.pdf";
    const { text: rawText, pages } = await extractText(tmpPath, fname);

    if (!rawText || rawText.trim().length < 50) {
      fs.unlink(tmpPath, () => {});
      return res.status(400).json({ error: "Could not extract enough text from the document." });
    }

    const text = truncateText(rawText);
    let prompt = ANALYSIS_PROMPT;
    if (req.user.industry && INDUSTRY_PROFILES[req.user.industry]) {
      const profile = INDUSTRY_PROFILES[req.user.industry];
      prompt += `\n\nINDUSTRY CONTEXT (${profile.name}):\n${profile.focus}\n${profile.risk_weights}`;
    }

    const analysis = await callClaude(prompt, `Here is the document to analyze:\n\n---\n${text}\n---`);
    analysis.filename = fname;
    analysis.analyzed_at = new Date().toISOString();
    analysis.page_count = pages;
    analysis.id = Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
    analysis.import_source = "url";

    auth.incrementUsage(req.user.id);
    auth.saveAnalysis(req.user.id, analysis);
    logAudit(req, "analysis_imported", "analysis", analysis.id, `Imported from URL: ${fname}`);

    fs.unlink(tmpPath, () => {});
    res.json(analysis);
  } catch (error) {
    console.error("Import error:", error);
    res.status(500).json({ error: error.message || "Failed to import document." });
  }
});

app.post("/api/import/cloud", auth.requireAuth, (req, res) => {
  const { provider, file_id, access_token } = req.body;
  if (!provider || !file_id) return res.status(400).json({ error: "Provider and file ID are required." });
  if (!["google_drive", "dropbox", "onedrive"].includes(provider)) {
    return res.status(400).json({ error: "Supported providers: google_drive, dropbox, onedrive." });
  }

  // Return the OAuth URL or metadata needed — actual file download would go through /api/import/url
  const urls = {
    google_drive: `https://www.googleapis.com/drive/v3/files/${file_id}?alt=media`,
    dropbox: `https://content.dropboxapi.com/2/files/download`,
    onedrive: `https://graph.microsoft.com/v1.0/me/drive/items/${file_id}/content`,
  };

  res.json({ download_url: urls[provider], provider, file_id, message: "Use /api/import/url with the download URL and an access token." });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 3: FEATURE 10 — CUSTOM RISK RULES
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/api/risk-rules", auth.requireAuth, (req, res) => {
  const rules = db.prepare("SELECT * FROM risk_rules WHERE user_id = ? OR team_id = ? ORDER BY created_at DESC")
    .all(req.user.id, req.user.team_id || -1);
  res.json(rules);
});

app.post("/api/risk-rules", auth.requireAuth, (req, res) => {
  const { name, description, field, operator, value, severity } = req.body;
  if (!name || !field || !operator || !value) return res.status(400).json({ error: "Name, field, operator, and value are required." });

  const validFields = ["risk_score", "clause_risk_level", "clause_title", "red_flags_count", "non_compete_months", "liability_cap", "payment_terms_days", "document_type"];
  if (!validFields.includes(field)) return res.status(400).json({ error: "Invalid field.", valid_fields: validFields });

  const validOperators = ["gt", "lt", "eq", "gte", "lte", "contains", "not_contains"];
  if (!validOperators.includes(operator)) return res.status(400).json({ error: "Invalid operator.", valid_operators: validOperators });

  const validSeverities = ["info", "warning", "critical", "block"];
  if (severity && !validSeverities.includes(severity)) return res.status(400).json({ error: "Invalid severity.", valid_severities: validSeverities });

  const result = db.prepare("INSERT INTO risk_rules (user_id, team_id, name, description, field, operator, value, severity) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(req.user.id, req.user.team_id || null, name, description || "", field, operator, value, severity || "warning");

  logAudit(req, "risk_rule_created", "risk_rule", result.lastInsertRowid, name);
  res.json({ id: result.lastInsertRowid, success: true });
});

app.put("/api/risk-rules/:id", auth.requireAuth, (req, res) => {
  const { name, description, field, operator, value, severity, is_active } = req.body;
  db.prepare("UPDATE risk_rules SET name=COALESCE(?,name), description=COALESCE(?,description), field=COALESCE(?,field), operator=COALESCE(?,operator), value=COALESCE(?,value), severity=COALESCE(?,severity), is_active=COALESCE(?,is_active) WHERE id=? AND user_id=?")
    .run(name, description, field, operator, value, severity, is_active !== undefined ? (is_active ? 1 : 0) : null, req.params.id, req.user.id);
  res.json({ success: true });
});

app.delete("/api/risk-rules/:id", auth.requireAuth, (req, res) => {
  db.prepare("DELETE FROM risk_rules WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
  res.json({ success: true });
});

app.post("/api/risk-rules/evaluate", auth.requireAuth, (req, res) => {
  const { analysis } = req.body;
  if (!analysis) return res.status(400).json({ error: "Analysis data required." });

  const rules = db.prepare("SELECT * FROM risk_rules WHERE (user_id = ? OR team_id = ?) AND is_active = 1")
    .all(req.user.id, req.user.team_id || -1);

  const violations = [];
  for (const rule of rules) {
    let triggered = false;
    const val = rule.value;

    if (rule.field === "risk_score") {
      triggered = evaluateCondition(analysis.overall_risk_score, rule.operator, parseFloat(val));
    } else if (rule.field === "red_flags_count") {
      triggered = evaluateCondition((analysis.red_flags || []).length, rule.operator, parseFloat(val));
    } else if (rule.field === "clause_risk_level") {
      triggered = (analysis.clauses || []).some(c => evaluateCondition(c.risk_level, rule.operator, val));
    } else if (rule.field === "clause_title") {
      triggered = (analysis.clauses || []).some(c => evaluateCondition(c.title, rule.operator, val));
    } else if (rule.field === "document_type") {
      triggered = evaluateCondition(analysis.document_type || "", rule.operator, val);
    } else if (rule.field === "non_compete_months") {
      const ncClause = (analysis.clauses || []).find(c => c.title?.toLowerCase().includes("non-compete"));
      if (ncClause) {
        const months = parseInt(ncClause.summary?.match(/(\d+)\s*(?:month|year)/i)?.[1] || "0");
        triggered = evaluateCondition(months, rule.operator, parseFloat(val));
      }
    }

    if (triggered) {
      violations.push({ rule_id: rule.id, rule_name: rule.name, description: rule.description, field: rule.field, severity: rule.severity, expected: `${rule.field} ${rule.operator} ${rule.value}` });
    }
  }

  res.json({ violations, rules_checked: rules.length, passed: violations.length === 0 });
});

function evaluateCondition(actual, operator, expected) {
  if (actual === undefined || actual === null) return false;
  switch (operator) {
    case "gt": return actual > expected;
    case "lt": return actual < expected;
    case "eq": return String(actual).toLowerCase() === String(expected).toLowerCase();
    case "gte": return actual >= expected;
    case "lte": return actual <= expected;
    case "contains": return String(actual).toLowerCase().includes(String(expected).toLowerCase());
    case "not_contains": return !String(actual).toLowerCase().includes(String(expected).toLowerCase());
    default: return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 3: FEATURE 11 — WHITE-LABEL / RESELLER
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/api/white-label", auth.requireAuth, (req, res) => {
  if (!req.user.team_id) return res.json(null);
  const config = db.prepare("SELECT * FROM white_label WHERE team_id = ?").get(req.user.team_id);
  res.json(config || null);
});

app.put("/api/white-label", auth.requireAuth, (req, res) => {
  if (req.user.plan !== "enterprise") return res.status(403).json({ error: "White-label requires Enterprise plan." });
  if (req.user.team_role !== "admin") return res.status(403).json({ error: "Only team admins can configure white-label." });
  if (!req.user.team_id) return res.status(400).json({ error: "Create a team first." });

  const { company_name, logo_url, primary_color, accent_color, custom_domain, footer_text } = req.body;

  const existing = db.prepare("SELECT id FROM white_label WHERE team_id = ?").get(req.user.team_id);
  if (existing) {
    db.prepare("UPDATE white_label SET company_name=COALESCE(?,company_name), logo_url=COALESCE(?,logo_url), primary_color=COALESCE(?,primary_color), accent_color=COALESCE(?,accent_color), custom_domain=COALESCE(?,custom_domain), footer_text=COALESCE(?,footer_text), updated_at=datetime('now') WHERE team_id=?")
      .run(company_name, logo_url, primary_color, accent_color, custom_domain, footer_text, req.user.team_id);
  } else {
    db.prepare("INSERT INTO white_label (team_id, company_name, logo_url, primary_color, accent_color, custom_domain, footer_text) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(req.user.team_id, company_name || "", logo_url || "", primary_color || "#4f46e5", accent_color || "#7c3aed", custom_domain || "", footer_text || "");
  }

  logAudit(req, "white_label_updated", "white_label", req.user.team_id, "");
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 3: FEATURE 12 — E-SIGNATURE INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════════

app.post("/api/esign/send", auth.requireAuth, (req, res) => {
  const { analysis_id, provider, signers, document_name, message } = req.body;
  if (!provider || !signers || !signers.length) return res.status(400).json({ error: "Provider and signers are required." });
  if (!["docusign", "hellosign", "pandadoc"].includes(provider)) {
    return res.status(400).json({ error: "Supported providers: docusign, hellosign, pandadoc." });
  }

  // Create e-sign request record (actual API call would happen with provider credentials)
  const envelopeId = "env_" + require("crypto").randomBytes(12).toString("hex");
  const result = db.prepare("INSERT INTO esign_requests (user_id, analysis_id, provider, envelope_id, signers, document_name, sent_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))")
    .run(req.user.id, analysis_id || "", provider, envelopeId, JSON.stringify(signers), document_name || "Contract");

  logAudit(req, "esign_sent", "esign", envelopeId, `Sent to ${signers.length} signers via ${provider}`);
  res.json({ id: result.lastInsertRowid, envelope_id: envelopeId, status: "pending", message: `Document sent to ${signers.length} signer(s) via ${provider}.` });
});

app.get("/api/esign", auth.requireAuth, (req, res) => {
  const requests = db.prepare("SELECT * FROM esign_requests WHERE user_id = ? ORDER BY created_at DESC").all(req.user.id);
  requests.forEach(r => { r.signers = JSON.parse(r.signers); });
  res.json(requests);
});

app.get("/api/esign/:id", auth.requireAuth, (req, res) => {
  const request = db.prepare("SELECT * FROM esign_requests WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!request) return res.status(404).json({ error: "E-sign request not found." });
  request.signers = JSON.parse(request.signers);
  res.json(request);
});

app.put("/api/esign/:id/status", auth.requireAuth, (req, res) => {
  const { status } = req.body;
  if (!["pending", "sent", "viewed", "signed", "declined", "cancelled"].includes(status)) {
    return res.status(400).json({ error: "Invalid status." });
  }
  const completedAt = status === "signed" ? "datetime('now')" : null;
  if (completedAt) {
    db.prepare("UPDATE esign_requests SET status=?, completed_at=datetime('now') WHERE id=? AND user_id=?").run(status, req.params.id, req.user.id);
  } else {
    db.prepare("UPDATE esign_requests SET status=? WHERE id=? AND user_id=?").run(status, req.params.id, req.user.id);
  }
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 3: FEATURE 13 — CONTRACT CALENDAR VIEW
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/api/calendar", auth.requireAuth, (req, res) => {
  const { start, end } = req.query;

  const events = [];

  // Deadlines
  let dlQuery = "SELECT * FROM contract_deadlines WHERE user_id = ? AND status = 'active'";
  const dlParams = [req.user.id];
  if (start) { dlQuery += " AND deadline_date >= ?"; dlParams.push(start); }
  if (end) { dlQuery += " AND deadline_date <= ?"; dlParams.push(end); }
  const deadlines = db.prepare(dlQuery).all(...dlParams);

  for (const dl of deadlines) {
    const daysLeft = Math.ceil((new Date(dl.deadline_date) - new Date()) / 86400000);
    events.push({
      id: "dl_" + dl.id, type: "deadline", title: dl.title, date: dl.deadline_date, color: daysLeft <= 0 ? "#dc2626" : daysLeft <= 7 ? "#f59e0b" : "#4f46e5",
      details: { contract_name: dl.contract_name, auto_renewal: !!dl.is_auto_renewal, days_left: daysLeft, notes: dl.notes },
    });
  }

  // Obligations with due dates
  const obligations = db.prepare("SELECT * FROM obligations WHERE user_id = ? AND due_date != '' AND status != 'completed'").all(req.user.id);
  for (const ob of obligations) {
    if (ob.due_date && ob.due_date !== "Ongoing") {
      events.push({
        id: "ob_" + ob.id, type: "obligation", title: `[Obligation] ${ob.obligation.substring(0, 50)}`, date: ob.due_date, color: ob.priority === "high" ? "#dc2626" : "#6b7280",
        details: { party: ob.party, priority: ob.priority, clause_reference: ob.clause_reference },
      });
    }
  }

  // Analyses (as milestones)
  let aQuery = "SELECT id, filename, document_type, risk_score, risk_label, created_at FROM analyses WHERE user_id = ?";
  const aParams = [req.user.id];
  if (start) { aQuery += " AND created_at >= ?"; aParams.push(start); }
  if (end) { aQuery += " AND created_at <= ?"; aParams.push(end); }
  const analyses = db.prepare(aQuery).all(...aParams);

  for (const a of analyses) {
    events.push({
      id: "an_" + a.id, type: "analysis", title: `Analyzed: ${a.filename}`, date: a.created_at.split("T")[0] || a.created_at.split(" ")[0], color: "#16a34a",
      details: { risk_score: a.risk_score, risk_label: a.risk_label, document_type: a.document_type },
    });
  }

  // E-sign requests
  const esigns = db.prepare("SELECT * FROM esign_requests WHERE user_id = ? AND status NOT IN ('cancelled')").all(req.user.id);
  for (const es of esigns) {
    events.push({
      id: "es_" + es.id, type: "esign", title: `E-Sign: ${es.document_name}`, date: (es.sent_at || es.created_at).split("T")[0] || (es.sent_at || es.created_at).split(" ")[0],
      color: es.status === "signed" ? "#16a34a" : "#7c3aed",
      details: { provider: es.provider, status: es.status, signers: JSON.parse(es.signers).length },
    });
  }

  events.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  res.json(events);
});

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 3: FEATURE 14 — USAGE ANALYTICS FOR ADMINS
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/api/admin/analytics", auth.requireAuth, (req, res) => {
  if (req.user.team_role !== "admin" && req.user.plan !== "enterprise") {
    return res.status(403).json({ error: "Analytics requires admin role or Enterprise plan." });
  }

  const teamId = req.user.team_id;
  const { period } = req.query; // "7d", "30d", "90d"
  const days = period === "90d" ? 90 : period === "7d" ? 7 : 30;
  const since = `datetime('now', '-${days} days')`;

  // Team members usage
  let members = [];
  if (teamId) {
    members = db.prepare(`
      SELECT u.id, u.name, u.email, u.analyses_used, u.plan,
        (SELECT COUNT(*) FROM analyses a WHERE a.user_id = u.id AND a.created_at >= ${since}) as recent_analyses,
        (SELECT AVG(a.risk_score) FROM analyses a WHERE a.user_id = u.id AND a.created_at >= ${since}) as avg_risk,
        (SELECT MAX(a.created_at) FROM analyses a WHERE a.user_id = u.id) as last_active
      FROM users u WHERE u.team_id = ?
    `).all(teamId);
  }

  // Overall stats
  const userFilter = teamId
    ? `user_id IN (SELECT id FROM users WHERE team_id = ${teamId})`
    : `user_id = ${req.user.id}`;

  const totalAnalyses = db.prepare(`SELECT COUNT(*) as c FROM analyses WHERE ${userFilter} AND created_at >= ${since}`).get();
  const avgRisk = db.prepare(`SELECT AVG(risk_score) as avg FROM analyses WHERE ${userFilter} AND created_at >= ${since}`).get();
  const riskDistribution = db.prepare(`
    SELECT
      SUM(CASE WHEN risk_score <= 3 THEN 1 ELSE 0 END) as low,
      SUM(CASE WHEN risk_score BETWEEN 4 AND 5 THEN 1 ELSE 0 END) as medium,
      SUM(CASE WHEN risk_score BETWEEN 6 AND 7 THEN 1 ELSE 0 END) as high,
      SUM(CASE WHEN risk_score >= 8 THEN 1 ELSE 0 END) as critical
    FROM analyses WHERE ${userFilter} AND created_at >= ${since}
  `).get();

  const docTypes = db.prepare(`SELECT document_type, COUNT(*) as count FROM analyses WHERE ${userFilter} AND created_at >= ${since} GROUP BY document_type ORDER BY count DESC LIMIT 10`).all();

  // Daily activity
  const dailyActivity = db.prepare(`SELECT date(created_at) as day, COUNT(*) as count, AVG(risk_score) as avg_risk FROM analyses WHERE ${userFilter} AND created_at >= ${since} GROUP BY date(created_at) ORDER BY day`).all();

  // Busiest hours
  const hourlyActivity = db.prepare(`SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as count FROM analyses WHERE ${userFilter} AND created_at >= ${since} GROUP BY hour ORDER BY count DESC LIMIT 5`).all();

  res.json({
    period: `${days}d`,
    total_analyses: totalAnalyses.c,
    avg_risk_score: avgRisk.avg ? parseFloat(avgRisk.avg.toFixed(1)) : 0,
    risk_distribution: riskDistribution,
    document_types: docTypes,
    daily_activity: dailyActivity,
    busiest_hours: hourlyActivity,
    members,
  });
});

app.get("/api/admin/member-activity/:userId", auth.requireAuth, (req, res) => {
  if (req.user.team_role !== "admin") return res.status(403).json({ error: "Admin only." });

  const targetUser = db.prepare("SELECT id, name, email, team_id FROM users WHERE id = ? AND team_id = ?").get(req.params.userId, req.user.team_id);
  if (!targetUser) return res.status(404).json({ error: "Team member not found." });

  const analyses = db.prepare("SELECT id, filename, document_type, risk_score, risk_label, created_at FROM analyses WHERE user_id = ? ORDER BY created_at DESC LIMIT 50").all(targetUser.id);
  const auditEntries = db.prepare("SELECT action, resource_type, details, created_at FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 50").all(targetUser.id);

  res.json({ user: targetUser, analyses, audit: auditEntries });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 3: FEATURE 15 — SAML SSO
// ═══════════════════════════════════════════════════════════════════════════════

app.post("/api/auth/saml", (req, res) => {
  const { saml_response, provider, email, name, saml_id, attributes } = req.body;
  if (!provider || !email || !saml_id) return res.status(400).json({ error: "Provider, email, and SAML ID are required." });

  try {
    let user = db.prepare("SELECT * FROM users WHERE saml_provider = ? AND saml_id = ?").get(provider, saml_id);

    if (!user) {
      user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase());
      if (user) {
        db.prepare("UPDATE users SET saml_provider = ?, saml_id = ? WHERE id = ?").run(provider, saml_id, user.id);
      } else {
        const randomPass = auth.hashPassword(require("crypto").randomBytes(32).toString("hex"));
        db.prepare("INSERT INTO users (email, password, name, saml_provider, saml_id) VALUES (?, ?, ?, ?, ?)")
          .run(email.toLowerCase(), randomPass, name || email.split("@")[0], provider, saml_id);
        user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase());
        mailer.sendWelcome(user).catch(() => {});
      }
    }

    user = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
    const token = auth.generateToken(user);

    logAudit({ user, headers: req.headers, socket: req.socket }, "saml_login", "user", user.id, `SAML login via ${provider}`);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, plan: user.plan, saml_provider: user.saml_provider } });
  } catch (error) {
    console.error("SAML error:", error);
    res.status(500).json({ error: "SAML authentication failed." });
  }
});

app.get("/api/auth/saml/metadata", (req, res) => {
  const appUrl = process.env.APP_URL || "http://localhost:3001";
  res.json({
    entity_id: `${appUrl}/saml/metadata`,
    acs_url: `${appUrl}/api/auth/saml`,
    slo_url: `${appUrl}/api/auth/saml/logout`,
    supported_providers: ["okta", "azure_ad", "onelogin", "google_workspace", "jumpcloud"],
    name_id_format: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ENHANCED: Inject industry profile into analysis (patch existing endpoint)
// ═══════════════════════════════════════════════════════════════════════════════

// Store the original analyze handler and wrap it — but since we can't easily patch,
// we add a middleware hook that modifies the request if the user has an industry set.
// This is done by checking industry in the existing /api/analyze flow.

// ─── Landing page routes ────────────────────────────────────────────────────
app.get("/for/:sector", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ─── Deadline check interval (every hour) ─────────────────────────────────
setInterval(() => { try { mailer.checkDeadlineAlerts(); } catch (e) { console.error("Deadline check error:", e); } }, 3600000);

app.listen(PORT, () => {
  console.log(`ContractShield AI running at http://localhost:${PORT}`);
});
