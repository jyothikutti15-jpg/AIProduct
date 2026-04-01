const http = require("http");

const BASE = "http://localhost:3001";
let TOKEN = null;
let TOKEN2 = null;
let totalPass = 0;
let totalFail = 0;

function check(name, condition) {
  if (condition) { totalPass++; console.log(`  PASS: ${name}`); }
  else { totalFail++; console.log(`  FAIL: ${name}`); }
}

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {},
    };
    if (token) options.headers["Authorization"] = "Bearer " + token;
    if (body && typeof body === "object" && !(body instanceof Buffer)) {
      body = JSON.stringify(body);
      options.headers["Content-Type"] = "application/json";
    }
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data: data }); }
      });
    });
    req.on("error", reject);
    if (body) req.write(typeof body === "string" ? body : "");
    req.end();
  });
}

async function run() {
  console.log("╔════════════════════════════════════════════════════════╗");
  console.log("║   CONTRACTSHIELD AI - FULL TEST SUITE                 ║");
  console.log("╠════════════════════════════════════════════════════════╣\n");

  // ── SUITE 1: Static Pages ──
  console.log("═══ SUITE 1: STATIC PAGES ═══");
  for (const path of ["/", "/style.css", "/app.js", "/for/real-estate", "/for/freelancers", "/for/startups", "/for/hr", "/for/construction"]) {
    const r = await request("GET", path);
    check(`GET ${path} -> ${r.status}`, r.status === 200);
  }

  // ── SUITE 2: Auth Signup ──
  console.log("\n═══ SUITE 2: AUTH SIGNUP ═══");

  const s1 = await request("POST", "/api/auth/signup", { name: "Alice Johnson", email: "alice@test.com", password: "securepass123", company: "Alice Corp" });
  check("Signup returns 201", s1.status === 201);
  check("Signup returns token", !!s1.data.token);
  check("User name correct", s1.data.user?.name === "Alice Johnson");
  check("Email correct", s1.data.user?.email === "alice@test.com");
  check("Company correct", s1.data.user?.company === "Alice Corp");
  check("Default plan is free", s1.data.user?.plan === "free");
  check("Analyses used is 0", s1.data.user?.analyses_used === 0);
  TOKEN = s1.data.token;

  const s2 = await request("POST", "/api/auth/signup", { name: "Dup", email: "alice@test.com", password: "password123" });
  check("Duplicate email rejected (409)", s2.status === 409);
  check("Duplicate error message", s2.data.error?.includes("already exists"));

  const s3 = await request("POST", "/api/auth/signup", { email: "x@x.com" });
  check("Missing fields rejected", !!s3.data.error);

  const s4 = await request("POST", "/api/auth/signup", { name: "X", email: "y@y.com", password: "123" });
  check("Short password rejected", s4.data.error?.includes("8 characters"));

  const s5 = await request("POST", "/api/auth/signup", { name: "X", email: "notanemail", password: "password123" });
  check("Invalid email rejected", s5.data.error?.includes("valid email"));

  // ── SUITE 3: Auth Login ──
  console.log("\n═══ SUITE 3: AUTH LOGIN ═══");

  const l1 = await request("POST", "/api/auth/login", { email: "alice@test.com", password: "securepass123" });
  check("Login returns 200", l1.status === 200);
  check("Login returns token", !!l1.data.token);
  check("Login user matches", l1.data.user?.name === "Alice Johnson");
  TOKEN = l1.data.token;

  const l2 = await request("POST", "/api/auth/login", { email: "alice@test.com", password: "wrong" });
  check("Wrong password rejected (401)", l2.status === 401);

  const l3 = await request("POST", "/api/auth/login", { email: "nobody@test.com", password: "x" });
  check("Non-existent user rejected", l3.status === 401);

  // ── SUITE 4: Session & Profile ──
  console.log("\n═══ SUITE 4: SESSION & PROFILE ═══");

  const m1 = await request("GET", "/api/auth/me", null, TOKEN);
  check("GET /me returns user", !!m1.data.user);
  check("Has limits", !!m1.data.user?.limits);
  check("Free plan: 3 analyses", m1.data.user?.limits?.analyses === 3);
  check("Free plan: 10 chats", m1.data.user?.limits?.chat === 10);
  check("Free plan: 0 compare", m1.data.user?.limits?.compare === 0);
  check("Free plan: 0 generate", m1.data.user?.limits?.generate === 0);

  const m2 = await request("GET", "/api/auth/me");
  check("No token -> 401", m2.status === 401);

  const m3 = await request("GET", "/api/auth/me", null, "invalidtoken");
  check("Invalid token -> 401", m3.status === 401);

  const p1 = await request("PUT", "/api/auth/profile", { name: "Alice Updated", company: "New Corp" }, TOKEN);
  check("Profile update success", p1.data.success === true);

  const m4 = await request("GET", "/api/auth/me", null, TOKEN);
  check("Name updated", m4.data.user?.name === "Alice Updated");
  check("Company updated", m4.data.user?.company === "New Corp");

  // ── SUITE 5: Billing ──
  console.log("\n═══ SUITE 5: BILLING ═══");

  const b1 = await request("GET", "/api/billing/status", null, TOKEN);
  check("Billing returns plan", b1.data.plan === "free");
  check("Billing returns limits", !!b1.data.limits);
  check("Billing returns usage", b1.data.analyses_used === 0);
  check("No subscription", b1.data.has_subscription === false);

  const b2 = await request("GET", "/api/billing/status");
  check("Billing requires auth", b2.status === 401);

  const b3 = await request("POST", "/api/billing/checkout", { plan: "starter" }, TOKEN);
  check("Checkout without Stripe -> error", !!b3.data.error);

  const b4 = await request("POST", "/api/billing/checkout", { plan: "invalid" }, TOKEN);
  check("Invalid plan rejected", b4.data.error === "Invalid plan.");

  // ── SUITE 6: Demo Endpoints ──
  console.log("\n═══ SUITE 6: DEMO ENDPOINTS ═══");

  const d1 = await request("POST", "/api/demo");
  check("Demo: has ID", !!d1.data.id);
  check("Demo: filename", d1.data.filename === "Sample_NDA_Agreement.pdf");
  check("Demo: doc type", d1.data.document_type === "Non-Disclosure Agreement (NDA)");
  check("Demo: summary length", d1.data.summary?.length > 50);
  check("Demo: 2 parties", d1.data.parties?.length === 2);
  check("Demo: 2 key dates", d1.data.key_dates?.length === 2);
  check("Demo: 2 financial terms", d1.data.financial_terms?.length === 2);
  check("Demo: 5 clauses", d1.data.clauses?.length === 5);
  check("Demo: clause has legal_reference", d1.data.clauses?.[0]?.legal_reference !== undefined);
  check("Demo: 3 missing clauses", d1.data.missing_clauses?.length === 3);
  check("Demo: risk score 7", d1.data.overall_risk_score === 7);
  check("Demo: risk label", d1.data.overall_risk_label === "High Risk");
  check("Demo: 3 red flags", d1.data.red_flags?.length === 3);
  check("Demo: 5 action items", d1.data.action_items?.length === 5);
  check("Demo: 4 negotiation pts", d1.data.negotiation_points?.length === 4);
  check("Demo: 2 compliance notes", d1.data.compliance_notes?.length === 2);
  check("Demo: language detected", d1.data.language_detected === "English");
  check("Demo: page count 4", d1.data.page_count === 4);
  check("Demo: total fields >= 18", Object.keys(d1.data).length >= 18);

  const d2 = await request("POST", "/api/demo/chat", { question: "test" });
  check("Demo chat: response present", d2.data.response?.length > 100);
  check("Demo chat: has advice", d2.data.response?.includes("non-compete") || d2.data.response?.includes("negotiate"));

  // ── SUITE 7: Error Handling ──
  console.log("\n═══ SUITE 7: ERROR HANDLING ═══");

  const e1 = await request("POST", "/api/analyze");
  check("Analyze no file -> error", e1.data.error === "No file uploaded");

  const e2 = await request("POST", "/api/compare");
  check("Compare no files -> error", e2.data.error?.includes("two documents"));

  const e3 = await request("POST", "/api/generate", {});
  check("Generate no type -> error", e3.data.error === "Template type is required.");

  const e4 = await request("POST", "/api/chat", {});
  check("Chat no context -> error", e4.data.error?.includes("required"));

  const e5 = await request("POST", "/api/chat", { analysis: { filename: "x" } });
  check("Chat no question -> error", e5.data.error?.includes("required"));

  const e6 = await request("GET", "/api/auth/history");
  check("History no auth -> 401", e6.status === 401);

  // ── SUITE 8: Usage Limits ──
  console.log("\n═══ SUITE 8: USAGE LIMITS ═══");

  const lm1 = await request("POST", "/api/compare", null, TOKEN);
  check("Compare blocked on free plan", lm1.data.error?.includes("require") || lm1.data.error?.includes("Professional"));
  check("Upgrade flag returned", lm1.data.upgrade === true);

  const lm2 = await request("POST", "/api/generate", { template_type: "NDA" }, TOKEN);
  check("Generate blocked on free plan", lm2.data.error?.includes("require") || lm2.data.error?.includes("Starter"));

  // ── SUITE 9: User Isolation ──
  console.log("\n═══ SUITE 9: USER ISOLATION ═══");

  const s6 = await request("POST", "/api/auth/signup", { name: "Bob Smith", email: "bob@test.com", password: "password456" });
  check("Second user created", s6.status === 201);
  TOKEN2 = s6.data.token;

  const h2 = await request("GET", "/api/auth/history", null, TOKEN2);
  check("Bob's history is empty", Array.isArray(h2.data) && h2.data.length === 0);

  const m5 = await request("GET", "/api/auth/me", null, TOKEN2);
  check("Bob's name is Bob Smith", m5.data.user?.name === "Bob Smith");
  check("Bob's usage is 0", m5.data.user?.analyses_used === 0);

  // ── SUITE 10: Frontend Code Quality ──
  console.log("\n═══ SUITE 10: FRONTEND CODE ═══");
  const fs = require("fs");
  const html = fs.readFileSync("public/index.html", "utf-8");
  const js = fs.readFileSync("public/app.js", "utf-8");
  const css = fs.readFileSync("public/style.css", "utf-8");

  check("8 pages in HTML", ["page-home","page-dashboard","page-compare","page-generate","page-history","page-settings","page-sector","page-payment-success"].every(p => html.includes('id="'+p+'"')));
  check("Login + Signup modals", html.includes("loginModal") && html.includes("signupModal"));
  check("Auth UI elements", html.includes("authButtons") && html.includes("userMenu"));
  check("All auth functions in JS", ["doSignup","doLogin","logout","loadUser","updateAuthUI","authHeaders"].every(f => js.includes(f)));
  check("Payment functions", ["startCheckout","openBillingPortal","loadSettings"].every(f => js.includes(f)));
  check("5 sector pages", ["real-estate","freelancers","startups","hr","construction"].every(s => js.includes(s)));
  check("Dark mode", js.includes("toggleTheme") && css.includes('[data-theme="dark"]'));
  check("10+ language options", (html.match(/<option/g) || []).length >= 10);
  check("XSS protection", js.includes("function escapeHtml"));
  check("Mobile responsive", css.includes("@media") && html.includes("mobile-menu"));
  check("Modal CSS", css.includes(".modal-overlay"));
  check("Sector CSS", css.includes(".sector-hero"));

  // ── SUMMARY ──
  console.log("\n╠════════════════════════════════════════════════════════╣");
  console.log(`║  TOTAL: ${totalPass} PASSED, ${totalFail} FAILED out of ${totalPass + totalFail} tests`);
  console.log("╚════════════════════════════════════════════════════════╝");

  if (totalFail > 0) process.exit(1);
}

run().catch((e) => { console.error("Test runner error:", e); process.exit(1); });
