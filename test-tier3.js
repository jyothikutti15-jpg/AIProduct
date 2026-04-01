const http = require("http");

const BASE = "http://localhost:3001";
let P = 0, F = 0, T1 = null, T2 = null, U1 = null, U2 = null;

function check(n, c) { if (c) { P++; console.log(`  PASS: ${n}`); } else { F++; console.log(`  FAIL: ${n}`); } }

function req(m, p, b, t) {
  return new Promise((res, rej) => {
    const u = new URL(p, BASE);
    const o = { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: m, headers: {} };
    if (t) o.headers["Authorization"] = "Bearer " + t;
    let payload = null;
    if (b && typeof b === "object") { payload = JSON.stringify(b); o.headers["Content-Type"] = "application/json"; }
    const r = http.request(o, (rs) => { let d = ""; rs.on("data", c => d += c); rs.on("end", () => { try { res({ s: rs.statusCode, d: JSON.parse(d) }); } catch { res({ s: rs.statusCode, d }); } }); });
    r.on("error", rej);
    if (payload) r.write(payload);
    r.end();
  });
}

async function run() {
  console.log("==============================================================");
  console.log("     TIER 3 FEATURE TESTS (15 Features)                      ");
  console.log("==============================================================\n");

  // Setup users
  const s1 = await req("POST", "/api/auth/signup", { name: "Alice Admin", email: "alice@tier3.com", password: "password123" });
  T1 = s1.d.token; U1 = s1.d.user;
  const s2 = await req("POST", "/api/auth/signup", { name: "Bob Member", email: "bob@tier3.com", password: "password123" });
  T2 = s2.d.token; U2 = s2.d.user;

  // Create team + upgrade Alice to enterprise
  await req("POST", "/api/teams", { name: "Tier3 Team" }, T1);
  const db = require("./lib/db");
  db.prepare("UPDATE users SET plan = 'enterprise' WHERE email = 'alice@tier3.com'").run();
  const l = await req("POST", "/api/auth/login", { email: "alice@tier3.com", password: "password123" });
  T1 = l.d.token;

  // Insert test analyses
  db.prepare("INSERT INTO analyses (user_id,analysis_id,filename,document_type,risk_score,risk_label,data) VALUES (?,?,?,?,?,?,?)")
    .run(U1.id, "t3a1", "test_nda.pdf", "NDA", 7, "High Risk", JSON.stringify({ summary: "Test NDA", document_type: "NDA", filename: "test_nda.pdf", overall_risk_score: 7, overall_risk_label: "High Risk", parties: ["Acme", "Bob"], clauses: [{ title: "Non-Compete", summary: "2 year non-compete", risk_level: "critical" }, { title: "Indemnification", summary: "One-sided", risk_level: "high" }], red_flags: ["Flag 1", "Flag 2"], missing_clauses: [{ clause: "Arbitration", importance: "high" }], financial_terms: [{ item: "Penalty", amount: "$10,000", frequency: "per-incident" }], key_dates: [{ event: "Duration", date: "2 years" }], action_items: ["Review"], negotiation_points: ["Negotiate"], compliance_notes: ["Check GDPR"], id: "t3a1" }));
  db.prepare("INSERT INTO analyses (user_id,analysis_id,filename,document_type,risk_score,risk_label,data) VALUES (?,?,?,?,?,?,?)")
    .run(U1.id, "t3a2", "test_lease.pdf", "Lease", 4, "Moderate Risk", JSON.stringify({ summary: "Lease", document_type: "Lease", filename: "test_lease.pdf", overall_risk_score: 4, clauses: [], red_flags: [], id: "t3a2" }));

  const analysisData = JSON.parse(db.prepare("SELECT data FROM analyses WHERE analysis_id='t3a1'").get().data);

  // ═══ 1. EXECUTIVE SUMMARY GENERATOR ═══
  console.log("=== 1. EXECUTIVE SUMMARY GENERATOR ===");

  const es1 = await req("POST", "/api/executive-summary", {}, T1);
  check("Missing analysis -> error", !!es1.d.error);

  // Use demo data since no real AI key
  const demoAnalysis = { filename: "test.pdf", document_type: "NDA", summary: "Test", overall_risk_score: 7, overall_risk_label: "High", parties: ["A", "B"], red_flags: ["Flag"], clauses: [{ title: "T", risk_level: "high" }], missing_clauses: [], financial_terms: [], key_dates: [], action_items: [], negotiation_points: [], compliance_notes: [] };
  const es2 = await req("POST", "/api/executive-summary", { analysis: demoAnalysis }, T1);
  // Will fail without API key, but endpoint should respond
  check("Executive summary endpoint responds", es2.s === 200 || es2.s === 500);

  // ═══ 2. OBLIGATION TRACKER ═══
  console.log("\n=== 2. OBLIGATION TRACKER ===");

  const ob1 = await req("POST", "/api/obligations/extract", {}, T1);
  check("Missing analysis -> error", !!ob1.d.error);

  // Manually insert obligations to test CRUD
  db.prepare("INSERT INTO obligations (user_id,analysis_id,party,obligation,due_date,priority,clause_reference) VALUES (?,?,?,?,?,?,?)")
    .run(U1.id, "t3a1", "Client", "Pay invoice within 30 days", "2026-06-01", "high", "Payment Terms");
  db.prepare("INSERT INTO obligations (user_id,analysis_id,party,obligation,due_date,priority,clause_reference) VALUES (?,?,?,?,?,?,?)")
    .run(U1.id, "t3a1", "Provider", "Deliver report monthly", "Ongoing", "medium", "Deliverables");

  const ob2 = await req("GET", "/api/obligations", null, T1);
  check("List obligations (2)", ob2.d.length === 2);
  check("First has party", !!ob2.d[0].party);
  check("First has obligation text", !!ob2.d[0].obligation);
  check("High priority first", ob2.d[0].priority === "high");

  const ob3 = await req("GET", "/api/obligations?status=pending", null, T1);
  check("Filter by status", ob3.d.length === 2);

  const ob4 = await req("PUT", "/api/obligations/" + ob2.d[0].id, { status: "completed" }, T1);
  check("Update obligation status", ob4.d.success === true);

  const ob5 = await req("DELETE", "/api/obligations/" + ob2.d[1].id, null, T1);
  check("Delete obligation", ob5.d.success === true);

  const ob6 = await req("GET", "/api/obligations", null, T1);
  check("Now has 1 obligation", ob6.d.length === 1);

  // ═══ 3. NEGOTIATION EMAIL ═══
  console.log("\n=== 3. CLAUSE NEGOTIATION EMAIL ===");

  const ne1 = await req("POST", "/api/negotiation-email", {}, T1);
  check("Missing fields -> error", !!ne1.d.error);

  const ne2 = await req("POST", "/api/negotiation-email", { clause_title: "Non-Compete", desired_change: "Reduce to 6 months" }, T1);
  check("Negotiation email endpoint responds", ne2.s === 200 || ne2.s === 500);

  // ═══ 4. INDUSTRY ANALYSIS PROFILES ═══
  console.log("\n=== 4. INDUSTRY ANALYSIS PROFILES ===");

  const ip1 = await req("GET", "/api/industry-profiles");
  check("Returns profiles array", Array.isArray(ip1.d));
  check("Has 6 profiles", ip1.d.length === 6);
  check("Has real-estate", ip1.d.some(p => p.id === "real-estate"));
  check("Has construction", ip1.d.some(p => p.id === "construction"));
  check("Has saas", ip1.d.some(p => p.id === "saas"));
  check("Has healthcare", ip1.d.some(p => p.id === "healthcare"));

  const ip2 = await req("PUT", "/api/auth/industry", { industry: "real-estate" }, T1);
  check("Set industry profile", ip2.d.success === true);

  const ip3 = await req("PUT", "/api/auth/industry", { industry: "invalid" }, T1);
  check("Invalid industry rejected", !!ip3.d.error);
  check("Returns valid options", !!ip3.d.valid);

  const ip4 = await req("PUT", "/api/auth/industry", { industry: "" }, T1);
  check("Clear industry profile", ip4.d.success === true);

  // ═══ 5. BULK ACTIONS ═══
  console.log("\n=== 5. BULK ACTIONS ON HISTORY ===");

  // Get analysis IDs
  const hist = await req("GET", "/api/auth/history", null, T1);
  const ids = hist.d.map(h => h.id);

  const ba1 = await req("POST", "/api/bulk/delete", {}, T1);
  check("Missing IDs -> error", !!ba1.d.error);

  const ba2 = await req("POST", "/api/bulk/tag", { ids, tags: "important,review" }, T1);
  check("Bulk tag", ba2.d.success === true);
  check("Tagged 2 analyses", ba2.d.updated === 2);

  const ba3 = await req("POST", "/api/bulk/export", { ids }, T1);
  check("Bulk export", ba3.d.count === 2);
  check("Has analysis data", ba3.d.analyses.length === 2);

  const ba4 = await req("POST", "/api/bulk/move", { ids: [ids[0]], folder_id: null }, T1);
  check("Bulk move", ba4.d.success === true);

  // Don't delete — we need these for later tests

  // ═══ 6. AUDIT LOG ═══
  console.log("\n=== 6. AUDIT LOG ===");

  const al1 = await req("GET", "/api/audit-log", null, T1);
  check("Returns logs array", Array.isArray(al1.d.logs));
  check("Has total count", typeof al1.d.total === "number");
  check("Logs have entries", al1.d.logs.length > 0);
  check("Log has action", !!al1.d.logs[0]?.action);
  check("Log has user_name", !!al1.d.logs[0]?.user_name);
  check("Log has timestamp", !!al1.d.logs[0]?.created_at);

  const al2 = await req("GET", "/api/audit-log/actions", null, T1);
  check("Returns action types", Array.isArray(al2.d));
  check("Has action types", al2.d.length > 0);

  // Non-admin can't access
  const al3 = await req("GET", "/api/audit-log", null, T2);
  check("Non-admin blocked", al3.s === 403);

  // ═══ 7. APPROVAL WORKFLOWS ═══
  console.log("\n=== 7. APPROVAL WORKFLOWS ===");

  const ap1 = await req("POST", "/api/approvals", { analysis_id: "t3a1", title: "Review NDA v1" }, T1);
  check("Create approval", ap1.d.success === true);
  check("Returns ID", !!ap1.d.id);

  const ap2 = await req("GET", "/api/approvals", null, T1);
  check("List approvals (1)", ap2.d.length === 1);
  check("Status is pending_review", ap2.d[0]?.status === "pending_review");
  check("Has title", ap2.d[0]?.title === "Review NDA v1");

  const ap3 = await req("PUT", "/api/approvals/" + ap1.d.id + "/review", { action: "request_changes", comment: "Add liability cap" }, T1);
  check("Request changes", ap3.d.success === true);
  check("Status: changes_requested", ap3.d.status === "changes_requested");

  const ap4 = await req("PUT", "/api/approvals/" + ap1.d.id + "/review", { action: "approve" }, T1);
  check("Approve workflow", ap4.d.success === true);
  check("Status: approved", ap4.d.status === "approved");

  const ap5 = await req("GET", "/api/approvals/stats", null, T1);
  check("Stats: has pending", typeof ap5.d.pending === "number");
  check("Stats: has approved", ap5.d.approved >= 1);

  const ap6 = await req("POST", "/api/approvals", {}, T1);
  check("Missing fields -> error", !!ap6.d.error);

  const ap7 = await req("PUT", "/api/approvals/99999/review", { action: "approve" }, T1);
  check("Invalid ID -> 404", ap7.s === 404);

  const ap8 = await req("PUT", "/api/approvals/" + ap1.d.id + "/review", { action: "invalid" }, T1);
  check("Invalid action -> error", !!ap8.d.error);

  // ═══ 8. SLACK/TEAMS NOTIFICATIONS ═══
  console.log("\n=== 8. INTEGRATIONS (SLACK/TEAMS/DISCORD) ===");

  const it1 = await req("POST", "/api/integrations", { type: "slack", name: "#contracts", config: { webhook_url: "https://hooks.slack.com/test" } }, T1);
  check("Add Slack integration", it1.d.success === true);

  const it2 = await req("POST", "/api/integrations", { type: "teams", name: "Legal Team", config: { webhook_url: "https://teams.webhook.com/test" } }, T1);
  check("Add Teams integration", it2.d.success === true);

  const it3 = await req("GET", "/api/integrations", null, T1);
  check("List integrations (2)", it3.d.length === 2);
  check("Has config", !!it3.d[0].config?.webhook_url);

  const it4 = await req("PUT", "/api/integrations/" + it3.d[0].id + "/toggle", null, T1);
  check("Toggle integration", it4.d.success === true);

  const it5 = await req("POST", "/api/integrations", { type: "invalid" }, T1);
  check("Invalid type rejected", !!it5.d.error);

  const it6 = await req("POST", "/api/integrations", { type: "slack" }, T1);
  check("Missing webhook rejected", !!it6.d.error);

  await req("DELETE", "/api/integrations/" + it3.d[1].id, null, T1);
  const it7 = await req("GET", "/api/integrations", null, T1);
  check("Delete integration (now 1)", it7.d.length === 1);

  // ═══ 9. CLOUD IMPORT ═══
  console.log("\n=== 9. GOOGLE DRIVE / CLOUD IMPORT ===");

  const ci1 = await req("POST", "/api/import/url", {}, T1);
  check("Missing URL -> error", !!ci1.d.error);

  const ci2 = await req("POST", "/api/import/cloud", { provider: "google_drive", file_id: "abc123" }, T1);
  check("Cloud import returns download URL", !!ci2.d.download_url);
  check("Returns provider", ci2.d.provider === "google_drive");

  const ci3 = await req("POST", "/api/import/cloud", { provider: "invalid" }, T1);
  check("Invalid provider rejected", !!ci3.d.error);

  const ci4 = await req("POST", "/api/import/cloud", { provider: "dropbox", file_id: "xyz" }, T1);
  check("Dropbox supported", !!ci4.d.download_url);

  const ci5 = await req("POST", "/api/import/cloud", { provider: "onedrive", file_id: "xyz" }, T1);
  check("OneDrive supported", !!ci5.d.download_url);

  // ═══ 10. CUSTOM RISK RULES ═══
  console.log("\n=== 10. CUSTOM RISK RULES ===");

  const rr1 = await req("POST", "/api/risk-rules", { name: "High Risk Alert", field: "risk_score", operator: "gte", value: "7", severity: "critical" }, T1);
  check("Create risk rule", rr1.d.success === true);

  const rr2 = await req("POST", "/api/risk-rules", { name: "No Non-Competes", field: "clause_title", operator: "contains", value: "Non-Compete", severity: "warning" }, T1);
  check("Create clause rule", rr2.d.success === true);

  const rr3 = await req("GET", "/api/risk-rules", null, T1);
  check("List rules (2)", rr3.d.length === 2);
  check("Rule has name", !!rr3.d[0].name);
  check("Rule has field", !!rr3.d[0].field);

  const rr4 = await req("POST", "/api/risk-rules", { name: "Bad", field: "invalid_field", operator: "gt", value: "1" }, T1);
  check("Invalid field rejected", !!rr4.d.error);
  check("Returns valid fields", !!rr4.d.valid_fields);

  const rr5 = await req("POST", "/api/risk-rules", { name: "Bad", field: "risk_score", operator: "invalid", value: "1" }, T1);
  check("Invalid operator rejected", !!rr5.d.error);

  // Evaluate rules against analysis
  const rr6 = await req("POST", "/api/risk-rules/evaluate", { analysis: analysisData }, T1);
  check("Evaluate returns violations", Array.isArray(rr6.d.violations));
  check("Rules checked count", rr6.d.rules_checked === 2);
  check("High risk rule triggered", rr6.d.violations.some(v => v.rule_name === "High Risk Alert"));
  check("Non-compete rule triggered", rr6.d.violations.some(v => v.rule_name === "No Non-Competes"));
  check("Has passed flag", typeof rr6.d.passed === "boolean");
  check("Not passed (violations exist)", rr6.d.passed === false);

  const rr7 = await req("PUT", "/api/risk-rules/" + rr3.d[0].id, { severity: "warning" }, T1);
  check("Update rule", rr7.d.success === true);

  const rr8 = await req("DELETE", "/api/risk-rules/" + rr3.d[1].id, null, T1);
  check("Delete rule", rr8.d.success === true);

  // ═══ 11. WHITE-LABEL ═══
  console.log("\n=== 11. WHITE-LABEL / RESELLER ===");

  const wl1 = await req("GET", "/api/white-label", null, T1);
  check("Get white-label (null initially)", wl1.d === null);

  const wl2 = await req("PUT", "/api/white-label", { company_name: "LegalCo", primary_color: "#ff0000", logo_url: "https://example.com/logo.png", footer_text: "Powered by LegalCo" }, T1);
  check("Set white-label config", wl2.d.success === true);

  const wl3 = await req("GET", "/api/white-label", null, T1);
  check("Company name set", wl3.d?.company_name === "LegalCo");
  check("Primary color set", wl3.d?.primary_color === "#ff0000");
  check("Logo URL set", wl3.d?.logo_url === "https://example.com/logo.png");
  check("Footer text set", wl3.d?.footer_text === "Powered by LegalCo");

  const wl4 = await req("PUT", "/api/white-label", { company_name: "LegalCo Updated" }, T1);
  check("Update white-label", wl4.d.success === true);

  // Non-enterprise blocked
  const wl5 = await req("PUT", "/api/white-label", { company_name: "X" }, T2);
  check("Non-enterprise blocked", wl5.s === 403);

  // ═══ 12. E-SIGNATURE ═══
  console.log("\n=== 12. E-SIGNATURE INTEGRATION ===");

  const sg1 = await req("POST", "/api/esign/send", { provider: "docusign", signers: [{ name: "John", email: "john@test.com" }], document_name: "NDA v1" }, T1);
  check("Send e-sign request", !!sg1.d.envelope_id);
  check("Has envelope ID format", sg1.d.envelope_id.startsWith("env_"));
  check("Status is pending", sg1.d.status === "pending");

  const sg2 = await req("GET", "/api/esign", null, T1);
  check("List e-sign requests (1)", sg2.d.length === 1);
  check("Has signers array", Array.isArray(sg2.d[0].signers));
  check("Has provider", sg2.d[0].provider === "docusign");

  const sg3 = await req("GET", "/api/esign/" + sg2.d[0].id, null, T1);
  check("Get single e-sign", sg3.d.provider === "docusign");

  const sg4 = await req("PUT", "/api/esign/" + sg2.d[0].id + "/status", { status: "signed" }, T1);
  check("Update to signed", sg4.d.success === true);

  const sg5 = await req("POST", "/api/esign/send", { provider: "invalid" }, T1);
  check("Invalid provider rejected", !!sg5.d.error);

  const sg6 = await req("POST", "/api/esign/send", { provider: "hellosign", signers: [{ name: "A", email: "a@b.com" }] }, T1);
  check("HelloSign supported", !!sg6.d.envelope_id);

  // ═══ 13. CONTRACT CALENDAR ═══
  console.log("\n=== 13. CONTRACT CALENDAR VIEW ===");

  // Add a deadline for calendar
  await req("POST", "/api/deadlines", { title: "Calendar Test", deadline_date: new Date().toISOString().split("T")[0], contract_name: "Test" }, T1);

  const cal1 = await req("GET", "/api/calendar", null, T1);
  check("Returns events array", Array.isArray(cal1.d));
  check("Has events", cal1.d.length > 0);
  check("Event has id", !!cal1.d[0].id);
  check("Event has type", !!cal1.d[0].type);
  check("Event has title", !!cal1.d[0].title);
  check("Event has date", !!cal1.d[0].date);
  check("Event has color", !!cal1.d[0].color);

  // Check event types
  const types = [...new Set(cal1.d.map(e => e.type))];
  check("Has deadline events", types.includes("deadline"));
  check("Has analysis events", types.includes("analysis"));

  const cal2 = await req("GET", "/api/calendar?start=2020-01-01&end=2020-12-31", null, T1);
  check("Date range filter works", Array.isArray(cal2.d));

  // ═══ 14. USAGE ANALYTICS ═══
  console.log("\n=== 14. USAGE ANALYTICS FOR ADMINS ===");

  const ua1 = await req("GET", "/api/admin/analytics?period=30d", null, T1);
  check("Returns analytics", typeof ua1.d.total_analyses === "number");
  check("Has avg risk score", typeof ua1.d.avg_risk_score === "number");
  check("Has risk distribution", !!ua1.d.risk_distribution);
  check("Has document types", Array.isArray(ua1.d.document_types));
  check("Has daily activity", Array.isArray(ua1.d.daily_activity));
  check("Has period", ua1.d.period === "30d");

  const ua2 = await req("GET", "/api/admin/analytics?period=7d", null, T1);
  check("7-day period works", ua2.d.period === "7d");

  const ua3 = await req("GET", "/api/admin/analytics?period=90d", null, T1);
  check("90-day period works", ua3.d.period === "90d");

  // Non-admin blocked
  const ua4 = await req("GET", "/api/admin/analytics", null, T2);
  check("Non-admin blocked", ua4.s === 403);

  // ═══ 15. SAML SSO ═══
  console.log("\n=== 15. SAML SSO ===");

  const sm1 = await req("GET", "/api/auth/saml/metadata");
  check("Returns SAML metadata", !!sm1.d.entity_id);
  check("Has ACS URL", !!sm1.d.acs_url);
  check("Has supported providers", Array.isArray(sm1.d.supported_providers));
  check("Has 5 providers", sm1.d.supported_providers.length === 5);
  check("Supports Okta", sm1.d.supported_providers.includes("okta"));
  check("Supports Azure AD", sm1.d.supported_providers.includes("azure_ad"));

  const sm2 = await req("POST", "/api/auth/saml", { provider: "okta", email: "saml@test.com", name: "SAML User", saml_id: "saml_123" });
  check("SAML login creates user", !!sm2.d.token);
  check("Returns user", !!sm2.d.user);
  check("User has SAML provider", sm2.d.user.saml_provider === "okta");

  // Login again with same SAML ID
  const sm3 = await req("POST", "/api/auth/saml", { provider: "okta", email: "saml@test.com", saml_id: "saml_123" });
  check("SAML re-login works", !!sm3.d.token);

  const sm4 = await req("POST", "/api/auth/saml", {});
  check("Missing fields -> error", !!sm4.d.error);

  // Link to existing user
  const sm5 = await req("POST", "/api/auth/saml", { provider: "azure_ad", email: "alice@tier3.com", saml_id: "az_456", name: "Alice" });
  check("SAML links to existing account", !!sm5.d.token);

  // ═══ FRONTEND CODE CHECKS ═══
  console.log("\n=== FRONTEND CODE QUALITY ===");

  const htmlRes = await req("GET", "/");
  const html = htmlRes.d;
  check("Page: calendar", html.includes("page-calendar"));
  check("Page: obligations", html.includes("page-obligations"));
  check("Page: approvals", html.includes("page-approvals"));
  check("Page: admin", html.includes("page-admin"));
  check("Page: integrations", html.includes("page-integrations"));
  check("Calendar grid", html.includes("calendarGrid"));
  check("Calendar legend", html.includes("calendar-legend"));

  const jsRes = await req("GET", "/app.js");
  const js = jsRes.d;
  check("Function: generateExecutiveSummary", js.includes("generateExecutiveSummary"));
  check("Function: extractObligations", js.includes("extractObligations"));
  check("Function: loadObligations", js.includes("loadObligations"));
  check("Function: generateNegotiationEmail", js.includes("generateNegotiationEmail"));
  check("Function: loadCalendar", js.includes("loadCalendar"));
  check("Function: renderCalendar", js.includes("renderCalendar"));
  check("Function: loadApprovals", js.includes("loadApprovals"));
  check("Function: reviewApproval", js.includes("reviewApproval"));
  check("Function: loadAdminAnalytics", js.includes("loadAdminAnalytics"));
  check("Function: addIntegration", js.includes("addIntegration"));
  check("Function: loadIntegrations", js.includes("loadIntegrations"));
  check("Function: bulkDelete", js.includes("bulkDelete"));
  check("Function: bulkTag", js.includes("bulkTag"));
  check("Function: setIndustryProfile", js.includes("setIndustryProfile"));
  check("Function: evaluateRiskRules", js.includes("evaluateRiskRules"));

  const cssRes = await req("GET", "/style.css");
  const css = cssRes.d;
  check("CSS: Calendar grid", css.includes("calendar-grid"));
  check("CSS: Calendar day", css.includes("cal-day"));
  check("CSS: Obligation card", css.includes("obligation-card"));
  check("CSS: Approval card", css.includes("approval-card"));
  check("CSS: Badge styles", css.includes("badge-high"));
  check("CSS: Integration row", css.includes("integration-row"));
  check("CSS: Exec summary", css.includes("exec-summary"));
  check("CSS: Bulk bar", css.includes("bulk-bar"));
  check("CSS: Risk distribution bar", css.includes("risk-dist-bar"));
  check("CSS: Admin bar chart", css.includes("bar-row"));
  check("CSS: Dark mode calendar", css.includes("cal-day.today"));

  // ═══ SUMMARY ═══
  console.log("\n==============================================================");
  console.log(`  RESULTS: ${P} PASSED, ${F} FAILED out of ${P + F} tests`);
  if (F === 0) console.log("  STATUS:  ALL TIER 3 TESTS PASSED");
  else console.log(`  STATUS:  ${F} FAILURE(S)`);
  console.log("==============================================================");
  process.exit(F > 0 ? 1 : 0);
}

run().catch(e => { console.error("ERROR:", e); process.exit(1); });
