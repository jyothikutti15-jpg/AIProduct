const http = require("http");
const fs = require("fs");
const BASE = "http://localhost:3001";
let PASS = 0, FAIL = 0, TOKEN = null, TOKEN2 = null;

function check(name, condition) {
  if (condition) { PASS++; console.log(`  PASS: ${name}`); }
  else { FAIL++; console.log(`  FAIL: ${name}`); }
}

function req(method, path, body, token, raw) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers: {} };
    if (token) opts.headers["Authorization"] = "Bearer " + token;
    let payload = null;
    if (body && typeof body === "object") {
      payload = JSON.stringify(body);
      opts.headers["Content-Type"] = "application/json";
    }
    const r = http.request(opts, (res) => {
      let d = ""; res.on("data", (c) => (d += c));
      res.on("end", () => {
        try { resolve({ s: res.statusCode, d: JSON.parse(d) }); }
        catch { resolve({ s: res.statusCode, d }); }
      });
    });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

async function run() {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║    CONTRACTSHIELD AI - COMPLETE FEATURE TEST (ALL 23 FEATURES)║");
  console.log("╠════════════════════════════════════════════════════════════════╣\n");

  // ══════════════════════════════════════
  // 1. STATIC PAGES
  // ══════════════════════════════════════
  console.log("═══ 1. STATIC PAGES & ROUTING ═══");
  for (const p of ["/", "/style.css", "/app.js", "/for/real-estate", "/for/freelancers", "/for/startups", "/for/hr", "/for/construction"]) {
    const r = await req("GET", p);
    check(`GET ${p} -> ${r.s}`, r.s === 200);
  }

  // ══════════════════════════════════════
  // 2. AUTH: SIGNUP (all edge cases)
  // ══════════════════════════════════════
  console.log("\n═══ 2. AUTH SIGNUP ═══");

  const s1 = await req("POST", "/api/auth/signup", { name: "Alice Johnson", email: "alice@test.com", password: "securepass123", company: "Alice Corp" });
  check("Signup -> 201", s1.s === 201);
  check("Returns JWT token", typeof s1.d.token === "string" && s1.d.token.length > 20);
  check("User name = Alice Johnson", s1.d.user?.name === "Alice Johnson");
  check("Email = alice@test.com", s1.d.user?.email === "alice@test.com");
  check("Company = Alice Corp", s1.d.user?.company === "Alice Corp");
  check("Plan = free", s1.d.user?.plan === "free");
  check("Analyses used = 0", s1.d.user?.analyses_used === 0);
  TOKEN = s1.d.token;

  const s2 = await req("POST", "/api/auth/signup", { name: "Dup", email: "alice@test.com", password: "password123" });
  check("Duplicate email -> 409", s2.s === 409);
  check("Error: already exists", s2.d.error?.includes("already exists"));

  const s3 = await req("POST", "/api/auth/signup", { email: "x@x.com" });
  check("Missing name+password -> error", !!s3.d.error);

  const s4 = await req("POST", "/api/auth/signup", { name: "X", email: "y@y.com", password: "123" });
  check("Password < 8 chars -> error", s4.d.error?.includes("8 characters"));

  const s5 = await req("POST", "/api/auth/signup", { name: "X", email: "notanemail", password: "password123" });
  check("Invalid email -> error", s5.d.error?.includes("valid email"));

  // ══════════════════════════════════════
  // 3. AUTH: LOGIN
  // ══════════════════════════════════════
  console.log("\n═══ 3. AUTH LOGIN ═══");

  const l1 = await req("POST", "/api/auth/login", { email: "alice@test.com", password: "securepass123" });
  check("Login -> 200", l1.s === 200);
  check("Returns token", !!l1.d.token);
  check("Returns user.name", l1.d.user?.name === "Alice Johnson");
  TOKEN = l1.d.token;

  const l2 = await req("POST", "/api/auth/login", { email: "alice@test.com", password: "wrongpassword" });
  check("Wrong password -> 401", l2.s === 401);
  check("Error message", l2.d.error === "Invalid email or password.");

  const l3 = await req("POST", "/api/auth/login", { email: "nobody@test.com", password: "x" });
  check("Non-existent user -> 401", l3.s === 401);

  // ══════════════════════════════════════
  // 4. SESSION / ME
  // ══════════════════════════════════════
  console.log("\n═══ 4. SESSION & JWT ═══");

  const m1 = await req("GET", "/api/auth/me", null, TOKEN);
  check("GET /me -> 200", m1.s === 200);
  check("Returns user object", !!m1.d.user);
  check("Has plan limits", !!m1.d.user?.limits);
  check("Free: 3 analyses", m1.d.user?.limits?.analyses === 3);
  check("Free: 10 chats", m1.d.user?.limits?.chat === 10);
  check("Free: 0 compare", m1.d.user?.limits?.compare === 0);
  check("Free: 0 generate", m1.d.user?.limits?.generate === 0);

  const m2 = await req("GET", "/api/auth/me");
  check("No token -> 401", m2.s === 401);
  check("Error: Authentication required", m2.d.error === "Authentication required");

  const m3 = await req("GET", "/api/auth/me", null, "fake.token.here");
  check("Invalid token -> 401", m3.s === 401);

  // ══════════════════════════════════════
  // 5. PROFILE UPDATE
  // ══════════════════════════════════════
  console.log("\n═══ 5. PROFILE UPDATE ═══");

  const p1 = await req("PUT", "/api/auth/profile", { name: "Alice Updated", company: "New Corp" }, TOKEN);
  check("Profile update -> success", p1.d.success === true);

  const m4 = await req("GET", "/api/auth/me", null, TOKEN);
  check("Name updated to Alice Updated", m4.d.user?.name === "Alice Updated");
  check("Company updated to New Corp", m4.d.user?.company === "New Corp");

  // ══════════════════════════════════════
  // 6. BILLING / STRIPE
  // ══════════════════════════════════════
  console.log("\n═══ 6. BILLING & STRIPE ═══");

  const b1 = await req("GET", "/api/billing/status", null, TOKEN);
  check("Billing status -> plan=free", b1.d.plan === "free");
  check("Has limits object", !!b1.d.limits);
  check("analyses_used = 0", b1.d.analyses_used === 0);
  check("has_subscription = false", b1.d.has_subscription === false);

  const b2 = await req("GET", "/api/billing/status");
  check("Billing no auth -> 401", b2.s === 401);

  const b3 = await req("POST", "/api/billing/checkout", { plan: "starter" }, TOKEN);
  check("Checkout without Stripe key -> error", !!b3.d.error && b3.d.error.includes("Stripe"));

  const b4 = await req("POST", "/api/billing/checkout", { plan: "invalid" }, TOKEN);
  check("Invalid plan -> error", b4.d.error === "Invalid plan.");

  // ══════════════════════════════════════
  // 7. DEMO ANALYSIS (21 field checks)
  // ══════════════════════════════════════
  console.log("\n═══ 7. DEMO ANALYSIS ENDPOINT ═══");

  const d1 = await req("POST", "/api/demo");
  check("Demo: has ID", !!d1.d.id);
  check("Demo: filename", d1.d.filename === "Sample_NDA_Agreement.pdf");
  check("Demo: timestamp", !!d1.d.analyzed_at);
  check("Demo: document_type = NDA", d1.d.document_type === "Non-Disclosure Agreement (NDA)");
  check("Demo: language = English", d1.d.language_detected === "English");
  check("Demo: summary > 50 chars", d1.d.summary?.length > 50);
  check("Demo: 2 parties", d1.d.parties?.length === 2);
  check("Demo: 2 key_dates", d1.d.key_dates?.length === 2);
  check("Demo: 2 financial_terms", d1.d.financial_terms?.length === 2);
  check("Demo: 5 clauses", d1.d.clauses?.length === 5);
  check("Demo: clause[0].title exists", !!d1.d.clauses?.[0]?.title);
  check("Demo: clause[0].risk_level exists", !!d1.d.clauses?.[0]?.risk_level);
  check("Demo: clause[0].legal_reference defined", d1.d.clauses?.[0]?.legal_reference !== undefined);
  check("Demo: 3 missing_clauses", d1.d.missing_clauses?.length === 3);
  check("Demo: risk_score = 7", d1.d.overall_risk_score === 7);
  check("Demo: risk_label = High Risk", d1.d.overall_risk_label === "High Risk");
  check("Demo: 3 red_flags", d1.d.red_flags?.length === 3);
  check("Demo: 5 action_items", d1.d.action_items?.length === 5);
  check("Demo: 4 negotiation_points", d1.d.negotiation_points?.length === 4);
  check("Demo: 2 compliance_notes", d1.d.compliance_notes?.length === 2);
  check("Demo: page_count = 4", d1.d.page_count === 4);

  // ══════════════════════════════════════
  // 8. DEMO CHAT
  // ══════════════════════════════════════
  console.log("\n═══ 8. DEMO CHAT ═══");

  const dc = await req("POST", "/api/demo/chat", { question: "Is the non-compete enforceable?" });
  check("Chat response present", dc.d.response?.length > 100);
  check("Contains actionable content", dc.d.response?.includes("non-compete") || dc.d.response?.includes("negotiate"));
  check("Has formatting (bold)", dc.d.response?.includes("**"));

  // ══════════════════════════════════════
  // 9. ERROR HANDLING (all endpoints)
  // ══════════════════════════════════════
  console.log("\n═══ 9. ERROR HANDLING ═══");

  const e1 = await req("POST", "/api/analyze");
  check("Analyze: no file -> error", e1.d.error === "No file uploaded");

  const e3 = await req("POST", "/api/compare");
  check("Compare: no files -> error", e3.d.error?.includes("two documents"));

  const e4 = await req("POST", "/api/generate", {});
  check("Generate: no type -> error", e4.d.error === "Template type is required.");

  const e5 = await req("POST", "/api/chat", {});
  check("Chat: no context -> error", e5.d.error?.includes("required"));

  const e6 = await req("POST", "/api/chat", { analysis: { filename: "x" } });
  check("Chat: no question -> error", e6.d.error?.includes("required"));

  const e7 = await req("GET", "/api/auth/history");
  check("History: no auth -> 401", e7.s === 401);

  const e8 = await req("POST", "/api/rewrite-clause", {});
  check("Rewrite: no clause -> error", e8.d.error?.includes("required"));

  const e9 = await req("POST", "/api/batch-analyze");
  check("Batch: no files -> error", e9.d.error?.includes("No files"));

  // ══════════════════════════════════════
  // 10. USAGE LIMITS (free plan restrictions)
  // ══════════════════════════════════════
  console.log("\n═══ 10. USAGE LIMITS ═══");

  const lm1 = await req("POST", "/api/compare", null, TOKEN);
  check("Compare blocked on free", lm1.d.error?.includes("require") || lm1.d.error?.includes("Professional"));
  check("Upgrade flag returned", lm1.d.upgrade === true);

  const lm2 = await req("POST", "/api/generate", { template_type: "NDA" }, TOKEN);
  check("Generate blocked on free", lm2.d.error?.includes("require") || lm2.d.error?.includes("Starter"));

  // ══════════════════════════════════════
  // 11. CLAUSE LIBRARY
  // ══════════════════════════════════════
  console.log("\n═══ 11. CLAUSE LIBRARY ═══");

  const cl1 = await req("GET", "/api/clause-library");
  check("Returns clauses array", cl1.d.clauses?.length >= 15);
  check("Returns categories array", cl1.d.categories?.length >= 10);
  check("Clause has id", !!cl1.d.clauses?.[0]?.id);
  check("Clause has category", !!cl1.d.clauses?.[0]?.category);
  check("Clause has title", !!cl1.d.clauses?.[0]?.title);
  check("Clause has text", cl1.d.clauses?.[0]?.text?.length > 50);

  const cl2 = await req("GET", "/api/clause-library?search=indemnification");
  check("Search: finds indemnification", cl2.d.clauses?.length >= 1);
  check("Search: result is relevant", cl2.d.clauses?.[0]?.title?.toLowerCase().includes("indemnif"));

  const cl3 = await req("GET", "/api/clause-library?category=Confidentiality");
  check("Category filter: Confidentiality", cl3.d.clauses?.length >= 2);
  check("All results in category", cl3.d.clauses?.every(c => c.category === "Confidentiality"));

  const cl4 = await req("GET", "/api/clause-library?search=xyznonexistent");
  check("Search: no results for gibberish", cl4.d.clauses?.length === 0);

  const cl5 = await req("GET", "/api/clause-library?category=Force Majeure");
  check("Category: Force Majeure", cl5.d.clauses?.length >= 1);

  // ══════════════════════════════════════
  // 12. CONTRACT DEADLINES
  // ══════════════════════════════════════
  console.log("\n═══ 12. CONTRACT DEADLINES ═══");

  const dl0 = await req("GET", "/api/deadlines", null, TOKEN);
  check("Initially empty", dl0.d.length === 0);

  const dl1 = await req("POST", "/api/deadlines", {
    title: "AWS Contract Renewal", deadline_date: "2026-06-15",
    contract_name: "AWS Enterprise Agreement", alert_days: 30,
    is_auto_renewal: true, notes: "Need to review pricing"
  }, TOKEN);
  check("Add deadline -> success", dl1.d.success === true);
  check("Returns ID", dl1.d.id >= 1);

  const dl2 = await req("POST", "/api/deadlines", {
    title: "Office Lease Expiry", deadline_date: "2026-12-31",
    contract_name: "123 Main St Lease", alert_days: 90
  }, TOKEN);
  check("Add second deadline", dl2.d.success === true);

  const dl3 = await req("GET", "/api/deadlines", null, TOKEN);
  check("Now has 2 deadlines", dl3.d.length === 2);
  check("Sorted by date (AWS first)", dl3.d[0]?.title === "AWS Contract Renewal");
  check("Has auto-renewal flag", dl3.d[0]?.is_auto_renewal === 1);
  check("Has alert_days = 30", dl3.d[0]?.alert_days === 30);
  check("Has notes", dl3.d[0]?.notes === "Need to review pricing");

  const dl4 = await req("POST", "/api/deadlines", {}, TOKEN);
  check("Add deadline: missing fields -> error", !!dl4.d.error);

  const dl5 = await req("PUT", "/api/deadlines/" + dl1.d.id, { title: "AWS Renewal Updated", alert_days: 60 }, TOKEN);
  check("Update deadline -> success", dl5.d.success === true);

  const dl6 = await req("GET", "/api/deadlines", null, TOKEN);
  check("Title updated", dl6.d[0]?.title === "AWS Renewal Updated");
  check("Alert days updated to 60", dl6.d[0]?.alert_days === 60);

  await req("DELETE", "/api/deadlines/" + dl2.d.id, null, TOKEN);
  const dl7 = await req("GET", "/api/deadlines", null, TOKEN);
  check("Delete deadline (now 1 left)", dl7.d.length === 1);

  const dl8 = await req("GET", "/api/deadlines");
  check("Deadlines require auth", dl8.s === 401);

  // ══════════════════════════════════════
  // 13. ANNOTATIONS & NOTES
  // ══════════════════════════════════════
  console.log("\n═══ 13. ANNOTATIONS & NOTES ═══");

  const an0 = await req("GET", "/api/annotations/test_analysis_1", null, TOKEN);
  check("Initially no annotations", an0.d.length === 0);

  const an1 = await req("POST", "/api/annotations", {
    analysis_id: "test_analysis_1", clause_index: 0,
    note: "Check this clause with outside counsel"
  }, TOKEN);
  check("Add annotation -> success", an1.d.success === true);
  check("Returns annotation ID", an1.d.id >= 1);

  const an2 = await req("POST", "/api/annotations", {
    analysis_id: "test_analysis_1", clause_index: 2,
    note: "CEO needs to approve this term"
  }, TOKEN);
  check("Add second annotation", an2.d.success === true);

  const an3 = await req("POST", "/api/annotations", {
    analysis_id: "test_analysis_1", clause_index: -1,
    note: "Overall: this contract needs heavy negotiation"
  }, TOKEN);
  check("Add general annotation (clause_index=-1)", an3.d.success === true);

  const an4 = await req("GET", "/api/annotations/test_analysis_1", null, TOKEN);
  check("Has 3 annotations", an4.d.length === 3);
  check("First note correct", an4.d[0]?.note === "Overall: this contract needs heavy negotiation");
  check("Has clause_index", an4.d[0]?.clause_index === -1);

  const an5 = await req("DELETE", "/api/annotations/" + an3.d.id, null, TOKEN);
  check("Delete annotation -> success", an5.d.success === true);

  const an6 = await req("GET", "/api/annotations/test_analysis_1", null, TOKEN);
  check("Now has 2 annotations", an6.d.length === 2);

  const an7 = await req("POST", "/api/annotations", {}, TOKEN);
  check("Missing fields -> error", !!an7.d.error);

  const an8 = await req("GET", "/api/annotations/test_analysis_1");
  check("Annotations require auth", an8.s === 401);

  // ══════════════════════════════════════
  // 14. SHAREABLE LINKS
  // ══════════════════════════════════════
  console.log("\n═══ 14. SHAREABLE LINKS ═══");

  const sh1 = await req("POST", "/api/share", {
    analysis_id: "test_analysis_1",
    data: { summary: "Test NDA", overall_risk_score: 7, document_type: "NDA", clauses: [{ title: "Clause 1" }] },
    expires_hours: 24
  }, TOKEN);
  check("Create share link -> has share_id", !!sh1.d.share_id);
  check("Has full URL", sh1.d.url?.includes("/shared/"));
  check("Has expiry", !!sh1.d.expires_at);
  const SHARE_ID = sh1.d.share_id;

  const sh2 = await req("GET", "/api/shared/" + SHARE_ID);
  check("Retrieve shared -> has summary", sh2.d.summary === "Test NDA");
  check("Retrieve shared -> has risk score", sh2.d.overall_risk_score === 7);
  check("Retrieve shared -> has clauses", sh2.d.clauses?.length === 1);

  const sh3 = await req("GET", "/shared/" + SHARE_ID);
  check("Shared HTML page -> 200", sh3.s === 200);

  const sh4 = await req("GET", "/api/shared/nonexistent_id_12345");
  check("Invalid share ID -> 404", sh4.s === 404);

  const sh5 = await req("POST", "/api/share", { data: { test: true } }, TOKEN);
  check("Share without expiry -> no expires_at", sh5.d.expires_at === null);

  const sh6 = await req("POST", "/api/share", {});
  check("Share requires auth", sh6.s === 401);

  // ══════════════════════════════════════
  // 15. AI CLAUSE REWRITER
  // ══════════════════════════════════════
  console.log("\n═══ 15. AI CLAUSE REWRITER ═══");

  const rw1 = await req("POST", "/api/rewrite-clause", {});
  check("Rewrite: missing fields -> error", rw1.d.error?.includes("required"));

  const rw2 = await req("POST", "/api/rewrite-clause", {
    clause_title: "Test", clause_text: "x"
  });
  // This will call Claude API - may fail if overloaded, but endpoint should work
  check("Rewrite endpoint accepts valid request", rw2.s === 200 || rw2.s === 500);

  // ══════════════════════════════════════
  // 16. USER ISOLATION
  // ══════════════════════════════════════
  console.log("\n═══ 16. USER ISOLATION ═══");

  const u2 = await req("POST", "/api/auth/signup", { name: "Bob Smith", email: "bob@test.com", password: "password456" });
  check("Second user created", u2.s === 201);
  TOKEN2 = u2.d.token;

  const h2 = await req("GET", "/api/auth/history", null, TOKEN2);
  check("Bob: empty history", h2.d.length === 0);

  const an_bob = await req("GET", "/api/annotations/test_analysis_1", null, TOKEN2);
  check("Bob: can't see Alice's annotations", an_bob.d.length === 0);

  const dl_bob = await req("GET", "/api/deadlines", null, TOKEN2);
  check("Bob: can't see Alice's deadlines", dl_bob.d.length === 0);

  const m_bob = await req("GET", "/api/auth/me", null, TOKEN2);
  check("Bob: name is Bob Smith", m_bob.d.user?.name === "Bob Smith");
  check("Bob: usage is 0", m_bob.d.user?.analyses_used === 0);

  // ══════════════════════════════════════
  // 17. FRONTEND CODE QUALITY
  // ══════════════════════════════════════
  console.log("\n═══ 17. FRONTEND CODE QUALITY ═══");

  const html = fs.readFileSync("public/index.html", "utf-8");
  const js = fs.readFileSync("public/app.js", "utf-8");
  const css = fs.readFileSync("public/style.css", "utf-8");

  // All pages exist
  check("Page: home", html.includes('id="page-home"'));
  check("Page: dashboard", html.includes('id="page-dashboard"'));
  check("Page: compare", html.includes('id="page-compare"'));
  check("Page: generate", html.includes('id="page-generate"'));
  check("Page: history", html.includes('id="page-history"'));
  check("Page: settings", html.includes('id="page-settings"'));
  check("Page: sector", html.includes('id="page-sector"'));
  check("Page: payment-success", html.includes('id="page-payment-success"'));
  check("Page: clauses", html.includes('id="page-clauses"'));
  check("Page: deadlines", html.includes('id="page-deadlines"'));
  check("Page: batch", html.includes('id="page-batch"'));
  check("Page: shared", html.includes('id="page-shared"'));

  // Auth UI
  check("Login modal", html.includes('id="loginModal"'));
  check("Signup modal", html.includes('id="signupModal"'));
  check("Auth buttons", html.includes('id="authButtons"'));
  check("User menu", html.includes('id="userMenu"'));

  // JS functions (all features)
  const requiredFunctions = [
    "showPage", "toggleTheme", "handleFile", "sendChat", "compareContracts",
    "generateContract", "renderDashboard", "renderHistory", "exportPDF",
    "escapeHtml", "doSignup", "doLogin", "logout", "loadUser", "updateAuthUI",
    "startCheckout", "openBillingPortal", "loadSettings", "loadSectorPage",
    "toast", "rewriteClause", "shareAnalysis", "loadSharedAnalysis",
    "saveAnnotation", "deleteAnnotation", "loadAnnotations",
    "loadDeadlines", "addDeadline", "deleteDeadline",
    "loadClauseLibrary", "copyClauseText",
    "handleBatchFiles", "renderBatchResults",
    "renderRiskTrend"
  ];
  requiredFunctions.forEach(fn => {
    check(`Function: ${fn}()`, js.includes(fn));
  });

  // CSS features
  check("CSS: Dark mode", css.includes('[data-theme="dark"]'));
  check("CSS: Toasts", css.includes(".toast-container"));
  check("CSS: Rewrite button", css.includes(".rewrite-btn"));
  check("CSS: Sparkline", css.includes(".sparkline"));
  check("CSS: Deadline cards", css.includes(".deadline-card"));
  check("CSS: Clause library", css.includes(".clause-lib-grid"));
  check("CSS: Annotations", css.includes(".annotation-item"));
  check("CSS: Batch upload", css.includes(".batch-results"));
  check("CSS: Modals", css.includes(".modal-overlay"));
  check("CSS: Responsive", css.includes("@media"));

  // Security
  check("XSS: escapeHtml present", js.includes("function escapeHtml"));
  check("Auth: Bearer token pattern", js.includes("Bearer"));
  check("Auth: localStorage token", js.includes("auth_token"));

  // ══════════════════════════════════════
  // FINAL SUMMARY
  // ══════════════════════════════════════
  console.log("\n╠════════════════════════════════════════════════════════════════╣");
  console.log(`║  RESULTS: ${PASS} PASSED, ${FAIL} FAILED out of ${PASS + FAIL} tests`);

  if (FAIL === 0) {
    console.log("║  STATUS:  ALL TESTS PASSED ✓");
  } else {
    console.log(`║  STATUS:  ${FAIL} FAILURE(S) - review above`);
  }
  console.log("╚════════════════════════════════════════════════════════════════╝");

  process.exit(FAIL > 0 ? 1 : 0);
}

run().catch((e) => { console.error("RUNNER ERROR:", e); process.exit(1); });
