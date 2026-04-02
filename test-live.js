const https = require("https");

const BASE = "https://contractshield-ai.onrender.com";
let P = 0, F = 0, TOKEN = null, USER = null;

function check(n, c) { if (c) { P++; console.log(`  PASS: ${n}`); } else { F++; console.log(`  FAIL: ${n}`); } }

function req(m, p, b, t) {
  return new Promise((res, rej) => {
    const u = new URL(p, BASE);
    const o = { hostname: u.hostname, port: 443, path: u.pathname + u.search, method: m, headers: {} };
    if (t) o.headers["Authorization"] = "Bearer " + t;
    let payload = null;
    if (b && typeof b === "object") { payload = JSON.stringify(b); o.headers["Content-Type"] = "application/json"; }
    const r = https.request(o, (rs) => { let d = ""; rs.on("data", c => d += c); rs.on("end", () => { try { res({ s: rs.statusCode, d: JSON.parse(d) }); } catch { res({ s: rs.statusCode, d }); } }); });
    r.on("error", rej);
    if (payload) r.write(payload);
    r.end();
  });
}

async function run() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  LIVE DEPLOYMENT TEST — contractshield-ai.onrender.com     ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // ═══ 1. STATIC PAGES ═══
  console.log("═══ 1. STATIC PAGES ═══");
  const pages = await Promise.all([
    req("GET", "/"),
    req("GET", "/style.css"),
    req("GET", "/app.js"),
    req("GET", "/for/real-estate"),
    req("GET", "/for/freelancers"),
    req("GET", "/for/startups"),
    req("GET", "/for/hr"),
    req("GET", "/for/construction"),
  ]);
  check("Home page loads", pages[0].s === 200);
  check("CSS loads", pages[1].s === 200);
  check("JS loads", pages[2].s === 200);
  check("Real estate page", pages[3].s === 200);
  check("Freelancers page", pages[4].s === 200);
  check("Startups page", pages[5].s === 200);
  check("HR page", pages[6].s === 200);
  check("Construction page", pages[7].s === 200);

  // ═══ 2. DEMO MODE (no auth, no API key needed) ═══
  console.log("\n═══ 2. DEMO MODE ═══");
  const demo = await req("POST", "/api/demo");
  check("Demo returns 200", demo.s === 200);
  check("Has analysis ID", !!demo.d.id);
  check("Has filename", demo.d.filename === "Sample_NDA_Agreement.pdf");
  check("Has document type", demo.d.document_type === "Non-Disclosure Agreement (NDA)");
  check("Has summary", demo.d.summary.length > 50);
  check("Has parties (2)", demo.d.parties.length === 2);
  check("Has key dates (2)", demo.d.key_dates.length === 2);
  check("Has financial terms (2)", demo.d.financial_terms.length === 2);
  check("Has 5 clauses", demo.d.clauses.length === 5);
  check("Clause has risk_level", !!demo.d.clauses[0].risk_level);
  check("Clause has legal_reference", demo.d.clauses[0].legal_reference !== undefined);
  check("Has missing clauses (3)", demo.d.missing_clauses.length === 3);
  check("Risk score = 7", demo.d.overall_risk_score === 7);
  check("Risk label = High Risk", demo.d.overall_risk_label === "High Risk");
  check("Has red flags (3)", demo.d.red_flags.length === 3);
  check("Has action items (5)", demo.d.action_items.length === 5);
  check("Has negotiation points (4)", demo.d.negotiation_points.length === 4);
  check("Has compliance notes (2)", demo.d.compliance_notes.length === 2);
  check("Has language detected", demo.d.language_detected === "English");
  check("Has page count", demo.d.page_count === 4);

  const demoChat = await req("POST", "/api/demo/chat");
  check("Demo chat works", demoChat.s === 200);
  check("Chat has response", !!demoChat.d.response);
  check("Chat has formatting", demoChat.d.response.includes("**"));

  // ═══ 3. CLAUSE LIBRARY (public, no auth) ═══
  console.log("\n═══ 3. CLAUSE LIBRARY ═══");
  const lib = await req("GET", "/api/clause-library");
  check("Returns clauses", lib.d.clauses.length >= 15);
  check("Returns categories", lib.d.categories.length >= 10);
  check("Clause has id", !!lib.d.clauses[0].id);
  check("Clause has category", !!lib.d.clauses[0].category);
  check("Clause has title", !!lib.d.clauses[0].title);
  check("Clause has text", !!lib.d.clauses[0].text);

  const search = await req("GET", "/api/clause-library?search=indemnification");
  check("Search works", search.d.clauses.length > 0);
  check("Search result relevant", search.d.clauses[0].title.toLowerCase().includes("indemnification"));

  const catFilter = await req("GET", "/api/clause-library?category=Confidentiality");
  check("Category filter works", catFilter.d.clauses.length > 0);
  check("All in category", catFilter.d.clauses.every(c => c.category === "Confidentiality"));

  // ═══ 4. INDUSTRY PROFILES (public) ═══
  console.log("\n═══ 4. INDUSTRY PROFILES ═══");
  const profiles = await req("GET", "/api/industry-profiles");
  check("Returns 6 profiles", profiles.d.length === 6);
  check("Has real-estate", profiles.d.some(p => p.id === "real-estate"));
  check("Has construction", profiles.d.some(p => p.id === "construction"));
  check("Has saas", profiles.d.some(p => p.id === "saas"));
  check("Has employment", profiles.d.some(p => p.id === "employment"));
  check("Has freelance", profiles.d.some(p => p.id === "freelance"));
  check("Has healthcare", profiles.d.some(p => p.id === "healthcare"));

  // ═══ 5. AUTH — SIGNUP + LOGIN ═══
  console.log("\n═══ 5. AUTH — SIGNUP + LOGIN ═══");
  const ts = Date.now();
  const signup = await req("POST", "/api/auth/signup", { name: "Test User", email: `test${ts}@demo.com`, password: "password123", company: "Demo Corp" });
  check("Signup returns 201", signup.s === 201);
  check("Has token", !!signup.d.token);
  check("Has user", !!signup.d.user);
  check("Name correct", signup.d.user.name === "Test User");
  check("Plan = free", signup.d.user.plan === "free");
  TOKEN = signup.d.token;
  USER = signup.d.user;

  const login = await req("POST", "/api/auth/login", { email: `test${ts}@demo.com`, password: "password123" });
  check("Login returns 200", login.s === 200);
  check("Login returns token", !!login.d.token);

  const me = await req("GET", "/api/auth/me", null, TOKEN);
  check("GET /me works", me.s === 200);
  check("Has limits", !!me.d.user.limits);
  check("Free: 3 analyses", me.d.user.limits.analyses === 3);

  // Bad auth
  const noAuth = await req("GET", "/api/auth/me");
  check("No token -> 401", noAuth.s === 401);

  const badAuth = await req("GET", "/api/auth/me", null, "invalid.token");
  check("Bad token -> 401", badAuth.s === 401);

  const badLogin = await req("POST", "/api/auth/login", { email: `test${ts}@demo.com`, password: "wrong" });
  check("Wrong password -> 401", badLogin.s === 401);

  // ═══ 6. PROFILE & SETTINGS ═══
  console.log("\n═══ 6. PROFILE & SETTINGS ═══");
  const profile = await req("PUT", "/api/auth/profile", { name: "Updated Name", company: "New Corp" }, TOKEN);
  check("Profile update works", profile.d.success === true);

  const billing = await req("GET", "/api/billing/status", null, TOKEN);
  check("Billing status works", billing.d.plan === "free");
  check("Has usage", typeof billing.d.analyses_used === "number");

  const prefs = await req("PUT", "/api/auth/email-prefs", { email_notifications: false }, TOKEN);
  check("Email prefs update", prefs.d.success === true);

  // ═══ 7. FOLDERS ═══
  console.log("\n═══ 7. FOLDERS ═══");
  const f1 = await req("POST", "/api/folders", { name: "Client Contracts", color: "#dc2626" }, TOKEN);
  check("Create folder", f1.d.success === true);

  const f2 = await req("POST", "/api/folders", { name: "Vendor Agreements", color: "#16a34a" }, TOKEN);
  check("Create second folder", f2.d.success === true);

  const fl = await req("GET", "/api/folders", null, TOKEN);
  check("List folders (2)", fl.d.length === 2);

  await req("DELETE", "/api/folders/" + fl.d[1].id, null, TOKEN);
  const fl2 = await req("GET", "/api/folders", null, TOKEN);
  check("Delete folder (now 1)", fl2.d.length === 1);

  // ═══ 8. DEADLINES ═══
  console.log("\n═══ 8. DEADLINES ═══");
  const dl1 = await req("POST", "/api/deadlines", { title: "AWS Contract Renewal", deadline_date: "2026-12-01", contract_name: "AWS Enterprise", alert_days: 30, is_auto_renewal: true, notes: "Check pricing" }, TOKEN);
  check("Create deadline", dl1.d.success === true);

  const dl2 = await req("POST", "/api/deadlines", { title: "Office Lease Expiry", deadline_date: "2027-03-15", contract_name: "Office Lease" }, TOKEN);
  check("Create second deadline", dl2.d.success === true);

  const dll = await req("GET", "/api/deadlines", null, TOKEN);
  check("List deadlines (2)", dll.d.length === 2);
  check("Sorted by date", dll.d[0].deadline_date <= dll.d[1].deadline_date);
  check("Has auto-renewal flag", dll.d[0].is_auto_renewal === 1);

  // ═══ 9. SHAREABLE LINKS ═══
  console.log("\n═══ 9. SHAREABLE LINKS ═══");
  const share = await req("POST", "/api/share", { data: demo.d, expires_hours: 24 }, TOKEN);
  check("Create share link", !!share.d.share_id);
  check("Has URL", !!share.d.url);
  check("Has expiry", !!share.d.expires_at);

  const shared = await req("GET", "/api/shared/" + share.d.share_id);
  check("View shared (no auth)", shared.s === 200);
  check("Shared has data", !!shared.d.summary);

  const badShare = await req("GET", "/api/shared/nonexistent");
  check("Invalid share -> 404", badShare.s === 404);

  // ═══ 10. ANNOTATIONS ═══
  console.log("\n═══ 10. ANNOTATIONS ═══");
  const an1 = await req("POST", "/api/annotations", { analysis_id: "demo_test", clause_index: 0, note: "Review this clause with lawyer" }, TOKEN);
  check("Create annotation", an1.d.success === true);

  const an2 = await req("POST", "/api/annotations", { analysis_id: "demo_test", clause_index: -1, note: "Overall: needs negotiation" }, TOKEN);
  check("Create general note", an2.d.success === true);

  const anl = await req("GET", "/api/annotations/demo_test", null, TOKEN);
  check("List annotations (2)", anl.d.length === 2);

  // ═══ 11. OBLIGATIONS ═══
  console.log("\n═══ 11. OBLIGATIONS ═══");
  const ob1 = await req("POST", "/api/obligations/extract", {}, TOKEN);
  check("Missing analysis -> error", !!ob1.d.error);

  // ═══ 12. APPROVAL WORKFLOWS ═══
  console.log("\n═══ 12. APPROVAL WORKFLOWS ═══");
  const ap1 = await req("POST", "/api/approvals", { analysis_id: "demo_test", title: "NDA Review - Q2 Partner" }, TOKEN);
  check("Create approval", ap1.d.success === true);

  const apl = await req("GET", "/api/approvals", null, TOKEN);
  check("List approvals (1)", apl.d.length === 1);
  check("Status: pending_review", apl.d[0].status === "pending_review");

  const ap2 = await req("PUT", "/api/approvals/" + ap1.d.id + "/review", { action: "approve", comment: "Looks good" }, TOKEN);
  check("Approve workflow", ap2.d.status === "approved");

  const aps = await req("GET", "/api/approvals/stats", null, TOKEN);
  check("Stats work", aps.d.approved >= 1);

  // ═══ 13. RISK RULES ═══
  console.log("\n═══ 13. RISK RULES ═══");
  const rr1 = await req("POST", "/api/risk-rules", { name: "High Risk Alert", field: "risk_score", operator: "gte", value: "7", severity: "critical" }, TOKEN);
  check("Create risk rule", rr1.d.success === true);

  const rrl = await req("GET", "/api/risk-rules", null, TOKEN);
  check("List rules (1)", rrl.d.length === 1);

  const rre = await req("POST", "/api/risk-rules/evaluate", { analysis: demo.d }, TOKEN);
  check("Evaluate: triggered", rre.d.violations.length > 0);
  check("Evaluate: high risk caught", rre.d.violations[0].rule_name === "High Risk Alert");

  // ═══ 14. INTEGRATIONS ═══
  console.log("\n═══ 14. INTEGRATIONS ═══");
  const it1 = await req("POST", "/api/integrations", { type: "slack", name: "#contracts", config: { webhook_url: "https://hooks.slack.com/test" } }, TOKEN);
  check("Add Slack integration", it1.d.success === true);

  const itl = await req("GET", "/api/integrations", null, TOKEN);
  check("List integrations (1)", itl.d.length === 1);

  // ═══ 15. CALENDAR ═══
  console.log("\n═══ 15. CALENDAR ═══");
  const cal = await req("GET", "/api/calendar", null, TOKEN);
  check("Calendar returns events", Array.isArray(cal.d));
  check("Has deadline events", cal.d.some(e => e.type === "deadline"));
  check("Events have required fields", cal.d.every(e => e.id && e.type && e.title && e.color));

  // ═══ 16. E-SIGNATURE ═══
  console.log("\n═══ 16. E-SIGNATURE ═══");
  const es1 = await req("POST", "/api/esign/send", { provider: "docusign", signers: [{ name: "John Smith", email: "john@acme.com" }], document_name: "Partnership NDA" }, TOKEN);
  check("Send e-sign request", !!es1.d.envelope_id);
  check("Envelope ID format", es1.d.envelope_id.startsWith("env_"));

  const esl = await req("GET", "/api/esign", null, TOKEN);
  check("List e-sign (1)", esl.d.length === 1);

  // ═══ 17. SAML SSO ═══
  console.log("\n═══ 17. SAML SSO ═══");
  const saml = await req("GET", "/api/auth/saml/metadata");
  check("SAML metadata", !!saml.d.entity_id);
  check("Has 5 providers", saml.d.supported_providers.length === 5);

  // ═══ 18. PLAN ENFORCEMENT ═══
  console.log("\n═══ 18. PLAN ENFORCEMENT ═══");
  const pe1 = await req("POST", "/api/compare", null, TOKEN);
  check("Free: compare blocked", pe1.s === 403 || (pe1.d && pe1.d.upgrade === true));

  const pe2 = await req("POST", "/api/generate", { template_type: "NDA" }, TOKEN);
  check("Free: generate blocked", pe2.s === 403 || (pe2.d && pe2.d.upgrade === true));

  const pe3 = await req("POST", "/api/keys", { name: "test" }, TOKEN);
  check("Free: API keys blocked", pe3.s === 403);

  // ═══ 19. ERROR HANDLING ═══
  console.log("\n═══ 19. ERROR HANDLING ═══");
  const err1 = await req("POST", "/api/auth/signup", {});
  check("Empty signup -> error", err1.s === 400);

  const err2 = await req("POST", "/api/deadlines", {}, TOKEN);
  check("Empty deadline -> error", !!err2.d.error);

  const err3 = await req("POST", "/api/annotations", {}, TOKEN);
  check("Empty annotation -> error", !!err3.d.error);

  const err4 = await req("POST", "/api/risk-rules", { name: "x", field: "invalid", operator: "gt", value: "1" }, TOKEN);
  check("Invalid risk field -> error", !!err4.d.error);

  const err5 = await req("POST", "/api/esign/send", { provider: "fake" }, TOKEN);
  check("Invalid e-sign provider -> error", !!err5.d.error);

  // ═══ SUMMARY ═══
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log(`║  RESULTS: ${P} PASSED, ${F} FAILED out of ${P + F} tests`);
  if (F === 0) console.log("║  STATUS:  ALL LIVE TESTS PASSED");
  else console.log(`║  STATUS:  ${F} FAILURE(S)`);
  console.log("║  URL:     https://contractshield-ai.onrender.com");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  process.exit(F > 0 ? 1 : 0);
}

run().catch(e => { console.error("ERROR:", e); process.exit(1); });
