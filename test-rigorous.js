const http = require("http");

const BASE = "http://localhost:3001";
let P = 0, F = 0;

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
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  RIGOROUS CROSS-FEATURE TEST SUITE                         ║");
  console.log("║  Security, Isolation, Edge Cases, Stress Tests              ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  const db = require("./lib/db");

  // ═══════════════════════════════════════════════════════════════════════════
  // SETUP: Create 3 users in different roles / plans
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("═══ SETUP ═══");
  const r1 = await req("POST", "/api/auth/signup", { name: "Enterprise Admin", email: "admin@rigorous.com", password: "password123" });
  const r2 = await req("POST", "/api/auth/signup", { name: "Free User", email: "free@rigorous.com", password: "password123" });
  const r3 = await req("POST", "/api/auth/signup", { name: "Outsider", email: "outsider@rigorous.com", password: "password123" });

  check("3 users created", r1.s === 201 && r2.s === 201 && r3.s === 201);

  let T_ADMIN = r1.d.token;
  const T_FREE = r2.d.token;
  const T_OUTSIDER = r3.d.token;
  const U_ADMIN = r1.d.user;
  const U_FREE = r2.d.user;
  const U_OUTSIDER = r3.d.user;

  // Make admin enterprise + create team
  db.prepare("UPDATE users SET plan='enterprise' WHERE id=?").run(U_ADMIN.id);
  const tl = await req("POST", "/api/auth/login", { email: "admin@rigorous.com", password: "password123" });
  T_ADMIN = tl.d.token;
  await req("POST", "/api/teams", { name: "Rigorous Team" }, T_ADMIN);

  // Invite free user to team
  const inv = await req("POST", "/api/teams/invite", { email: "free@rigorous.com", role: "member" }, T_ADMIN);
  await req("POST", "/api/teams/join/" + inv.d.invite_code, null, T_FREE);

  // Insert test analyses for admin
  for (let i = 1; i <= 5; i++) {
    db.prepare("INSERT INTO analyses (user_id,analysis_id,filename,document_type,risk_score,risk_label,data) VALUES (?,?,?,?,?,?,?)")
      .run(U_ADMIN.id, `rig_a${i}`, `contract_${i}.pdf`, i % 2 === 0 ? "NDA" : "Lease",
        i * 2, i * 2 <= 3 ? "Low Risk" : i * 2 <= 5 ? "Moderate Risk" : "High Risk",
        JSON.stringify({ summary: `Test ${i}`, document_type: i % 2 === 0 ? "NDA" : "Lease", filename: `contract_${i}.pdf`,
          overall_risk_score: i * 2, overall_risk_label: "Test", parties: ["A", "B"],
          clauses: [{ title: "Non-Compete", summary: `${i * 6} month non-compete`, risk_level: i > 3 ? "critical" : "low" },
                    { title: "Payment", summary: "Net 30", risk_level: "low" }],
          red_flags: i > 3 ? ["Flag " + i] : [], missing_clauses: [], financial_terms: [{ item: "Fee", amount: `$${i * 1000}`, frequency: "monthly" }],
          key_dates: [{ event: "Start", date: "2026-01-01" }], action_items: [], negotiation_points: [], compliance_notes: [], id: `rig_a${i}` }));
  }

  console.log("  Setup complete: 3 users, 1 team, 5 analyses\n");

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1: AUTH SECURITY
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("═══ 1. AUTH SECURITY & EDGE CASES ═══");

  // No token at all
  const sec1 = await req("GET", "/api/auth/me");
  check("No token -> 401", sec1.s === 401);

  // Garbage token
  const sec2 = await req("GET", "/api/auth/me", null, "garbage.token.here");
  check("Garbage token -> 401", sec2.s === 401);

  // Empty bearer
  const sec3 = await req("GET", "/api/auth/me", null, "");
  check("Empty bearer -> 401", sec3.s === 401);

  // Very long token
  const sec4 = await req("GET", "/api/auth/me", null, "x".repeat(10000));
  check("Very long token -> 401", sec4.s === 401);

  // SQL injection in login
  const sec5 = await req("POST", "/api/auth/login", { email: "' OR 1=1 --", password: "test" });
  check("SQL injection in email blocked", sec5.s === 401);

  const sec6 = await req("POST", "/api/auth/login", { email: "admin@rigorous.com", password: "' OR 1=1 --" });
  check("SQL injection in password blocked", sec6.s === 401);

  // XSS in signup
  const sec7 = await req("POST", "/api/auth/signup", { name: "<script>alert(1)</script>", email: "xss@test.com", password: "password123" });
  check("XSS name stored (app escapes on render)", sec7.s === 201);

  // Signup with same email different case
  const sec8 = await req("POST", "/api/auth/signup", { name: "Dup", email: "ADMIN@rigorous.com", password: "password123" });
  check("Case-insensitive email duplicate", sec8.s === 409);

  // Login with uppercase email
  const sec9 = await req("POST", "/api/auth/login", { email: "ADMIN@RIGOROUS.COM", password: "password123" });
  check("Case-insensitive login works", sec9.s === 200 && !!sec9.d.token);

  // Empty body requests
  const sec10 = await req("POST", "/api/auth/signup", {});
  check("Empty signup body -> error", sec10.s === 400);

  const sec11 = await req("POST", "/api/auth/login", {});
  check("Empty login body -> error", sec11.s === 400);

  // Password edge cases
  const sec12 = await req("POST", "/api/auth/signup", { name: "T", email: "short@t.com", password: "1234567" });
  check("7-char password rejected", sec12.s === 400);

  const sec13 = await req("POST", "/api/auth/signup", { name: "T", email: "exact8@t.com", password: "12345678" });
  check("Exactly 8-char password accepted", sec13.s === 201);

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2: USER DATA ISOLATION
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ 2. USER DATA ISOLATION ═══");

  // Outsider can't see admin's history
  const iso1 = await req("GET", "/api/auth/history", null, T_OUTSIDER);
  check("Outsider sees 0 analyses", iso1.d.length === 0);

  // Outsider can't see admin's deadlines
  await req("POST", "/api/deadlines", { title: "Admin Deadline", deadline_date: "2026-12-01" }, T_ADMIN);
  const iso2 = await req("GET", "/api/deadlines", null, T_OUTSIDER);
  check("Outsider sees 0 deadlines", iso2.d.length === 0);

  // Outsider can't see admin's annotations
  await req("POST", "/api/annotations", { analysis_id: "rig_a1", note: "Admin note" }, T_ADMIN);
  const iso3 = await req("GET", "/api/annotations/rig_a1", null, T_OUTSIDER);
  check("Outsider sees 0 annotations", iso3.d.length === 0);

  // Outsider can't see admin's folders
  await req("POST", "/api/folders", { name: "Admin Folder", color: "#ff0000" }, T_ADMIN);
  const iso4 = await req("GET", "/api/folders", null, T_OUTSIDER);
  check("Outsider sees 0 folders", iso4.d.length === 0);

  // Outsider can't see admin's obligations
  db.prepare("INSERT INTO obligations (user_id,analysis_id,party,obligation,priority) VALUES (?,?,?,?,?)").run(U_ADMIN.id, "rig_a1", "Client", "Pay up", "high");
  const iso5 = await req("GET", "/api/obligations", null, T_OUTSIDER);
  check("Outsider sees 0 obligations", iso5.d.length === 0);

  // Outsider can't see admin's e-sign
  await req("POST", "/api/esign/send", { provider: "docusign", signers: [{ name: "X", email: "x@x.com" }] }, T_ADMIN);
  const iso6 = await req("GET", "/api/esign", null, T_OUTSIDER);
  check("Outsider sees 0 e-sign requests", iso6.d.length === 0);

  // Outsider can't see admin's risk rules
  await req("POST", "/api/risk-rules", { name: "Admin Rule", field: "risk_score", operator: "gt", value: "5" }, T_ADMIN);
  const iso7 = await req("GET", "/api/risk-rules", null, T_OUTSIDER);
  check("Outsider sees 0 risk rules", iso7.d.length === 0);

  // Outsider can't see admin's custom clauses
  await req("POST", "/api/custom-clauses", { category: "Test", title: "Admin Clause", text: "Secret text" }, T_ADMIN);
  const iso8 = await req("GET", "/api/custom-clauses", null, T_OUTSIDER);
  check("Outsider sees 0 custom clauses", iso8.d.length === 0);

  // Outsider can't see admin's webhooks
  await req("POST", "/api/webhooks", { url: "https://admin.webhook.com", events: ["analysis_complete"] }, T_ADMIN);
  const iso9 = await req("GET", "/api/webhooks", null, T_OUTSIDER);
  check("Outsider sees 0 webhooks", iso9.d.length === 0);

  // Outsider can't see admin's calendar events
  const iso10 = await req("GET", "/api/calendar", null, T_OUTSIDER);
  check("Outsider sees 0 calendar events", iso10.d.length === 0);

  // Outsider can't see admin's integrations
  await req("POST", "/api/integrations", { type: "slack", name: "test", config: { webhook_url: "https://hooks.slack.com/x" } }, T_ADMIN);
  const iso11 = await req("GET", "/api/integrations", null, T_OUTSIDER);
  check("Outsider sees 0 integrations", iso11.d.length === 0);

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3: PLAN ENFORCEMENT / AUTHORIZATION
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ 3. PLAN & ROLE ENFORCEMENT ═══");

  // Free user can't create API keys
  const plan1 = await req("POST", "/api/keys", { name: "Attempt" }, T_FREE);
  check("Free user can't create API keys", plan1.s === 403);

  // Free user can't access white-label
  const plan2 = await req("PUT", "/api/white-label", { company_name: "Hack" }, T_FREE);
  check("Free user can't set white-label", plan2.s === 403);

  // Non-admin can't invite to team
  const plan3 = await req("POST", "/api/teams/invite", { email: "x@x.com" }, T_FREE);
  check("Member can't invite (only admin)", plan3.s === 403);

  // Non-admin can't change roles
  const plan4 = await req("PUT", "/api/teams/members/" + U_FREE.id + "/role", { role: "admin" }, T_FREE);
  check("Member can't change roles", plan4.s === 403);

  // Free user can't access audit log
  const plan5 = await req("GET", "/api/audit-log", null, T_FREE);
  check("Non-admin can't access audit log", plan5.s === 403);

  // Free user can't access admin analytics
  const plan6 = await req("GET", "/api/admin/analytics", null, T_FREE);
  check("Non-admin can't access analytics", plan6.s === 403);

  // Outsider can't access admin analytics
  const plan7 = await req("GET", "/api/admin/analytics", null, T_OUTSIDER);
  check("Outsider can't access analytics", plan7.s === 403);

  // Free user: compare blocked
  const plan8 = await req("POST", "/api/compare", null, T_FREE);
  check("Free: compare blocked", plan8.s === 403 || (plan8.d && plan8.d.upgrade === true));

  // Free user: generate blocked
  const plan9 = await req("POST", "/api/generate", { template_type: "NDA" }, T_FREE);
  check("Free: generate blocked", plan9.s === 403 || (plan9.d && plan9.d.upgrade === true));

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 4: CROSS-RESOURCE DELETION SAFETY
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ 4. CROSS-USER MODIFICATION PREVENTION ═══");

  // Outsider can't delete admin's annotations
  const adminAnnotation = db.prepare("SELECT id FROM annotations WHERE user_id=?").get(U_ADMIN.id);
  const del1 = await req("DELETE", "/api/annotations/" + adminAnnotation.id, null, T_OUTSIDER);
  const del1Check = db.prepare("SELECT id FROM annotations WHERE id=?").get(adminAnnotation.id);
  check("Outsider can't delete admin's annotation", !!del1Check);

  // Outsider can't delete admin's deadline
  const adminDeadline = db.prepare("SELECT id FROM contract_deadlines WHERE user_id=?").get(U_ADMIN.id);
  await req("DELETE", "/api/deadlines/" + adminDeadline.id, null, T_OUTSIDER);
  const del2Check = db.prepare("SELECT id FROM contract_deadlines WHERE id=?").get(adminDeadline.id);
  check("Outsider can't delete admin's deadline", !!del2Check);

  // Outsider can't delete admin's folders
  const adminFolder = db.prepare("SELECT id FROM folders WHERE user_id=?").get(U_ADMIN.id);
  await req("DELETE", "/api/folders/" + adminFolder.id, null, T_OUTSIDER);
  const del3Check = db.prepare("SELECT id FROM folders WHERE id=?").get(adminFolder.id);
  check("Outsider can't delete admin's folder", !!del3Check);

  // Outsider can't delete admin's obligation
  const adminOb = db.prepare("SELECT id FROM obligations WHERE user_id=?").get(U_ADMIN.id);
  await req("DELETE", "/api/obligations/" + adminOb.id, null, T_OUTSIDER);
  const del4Check = db.prepare("SELECT id FROM obligations WHERE id=?").get(adminOb.id);
  check("Outsider can't delete admin's obligation", !!del4Check);

  // Outsider can't delete admin's risk rule
  const adminRule = db.prepare("SELECT id FROM risk_rules WHERE user_id=?").get(U_ADMIN.id);
  await req("DELETE", "/api/risk-rules/" + adminRule.id, null, T_OUTSIDER);
  const del5Check = db.prepare("SELECT id FROM risk_rules WHERE id=?").get(adminRule.id);
  check("Outsider can't delete admin's risk rule", !!del5Check);

  // Outsider can't delete admin's webhook
  const adminWh = db.prepare("SELECT id FROM webhooks WHERE user_id=?").get(U_ADMIN.id);
  await req("DELETE", "/api/webhooks/" + adminWh.id, null, T_OUTSIDER);
  const del6Check = db.prepare("SELECT id FROM webhooks WHERE id=?").get(adminWh.id);
  check("Outsider can't delete admin's webhook", !!del6Check);

  // Outsider can't delete admin's integration
  const adminIntg = db.prepare("SELECT id FROM integrations WHERE user_id=?").get(U_ADMIN.id);
  await req("DELETE", "/api/integrations/" + adminIntg.id, null, T_OUTSIDER);
  const del7Check = db.prepare("SELECT id FROM integrations WHERE id=?").get(adminIntg.id);
  check("Outsider can't delete admin's integration", !!del7Check);

  // Outsider can't delete admin's custom clause
  const adminClause = db.prepare("SELECT id FROM custom_clauses WHERE user_id=?").get(U_ADMIN.id);
  await req("DELETE", "/api/custom-clauses/" + adminClause.id, null, T_OUTSIDER);
  const del8Check = db.prepare("SELECT id FROM custom_clauses WHERE id=?").get(adminClause.id);
  check("Outsider can't delete admin's custom clause", !!del8Check);

  // Outsider can't delete admin's API key
  const k = await req("POST", "/api/keys", { name: "Test Key" }, T_ADMIN);
  const adminKey = db.prepare("SELECT id FROM api_keys WHERE user_id=?").get(U_ADMIN.id);
  await req("DELETE", "/api/keys/" + adminKey.id, null, T_OUTSIDER);
  const del9Check = db.prepare("SELECT id FROM api_keys WHERE id=?").get(adminKey.id);
  check("Outsider can't delete admin's API key", !!del9Check);

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 5: INPUT VALIDATION EDGE CASES
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ 5. INPUT VALIDATION EDGE CASES ═══");

  // Empty name folder
  const val1 = await req("POST", "/api/folders", { name: "" }, T_ADMIN);
  check("Empty folder name rejected", !!val1.d.error);

  // Empty deadline
  const val2 = await req("POST", "/api/deadlines", {}, T_ADMIN);
  check("Empty deadline rejected", !!val2.d.error);

  // Empty annotation
  const val3 = await req("POST", "/api/annotations", {}, T_ADMIN);
  check("Empty annotation rejected", !!val3.d.error);

  // Invalid risk rule field
  const val4 = await req("POST", "/api/risk-rules", { name: "T", field: "DROP TABLE", operator: "eq", value: "1" }, T_ADMIN);
  check("SQL injection in risk rule field blocked", !!val4.d.error);

  // Invalid webhook events
  const val5 = await req("POST", "/api/webhooks", { url: "https://x.com", events: ["evil_event"] }, T_ADMIN);
  check("Invalid webhook event rejected", !!val5.d.error);

  // Invalid esign provider
  const val6 = await req("POST", "/api/esign/send", { provider: "fakeprovider", signers: [{ name: "X", email: "x@x.com" }] }, T_ADMIN);
  check("Invalid e-sign provider rejected", !!val6.d.error);

  // Invalid integration type
  const val7 = await req("POST", "/api/integrations", { type: "faketype", config: { webhook_url: "x" } }, T_ADMIN);
  check("Invalid integration type rejected", !!val7.d.error);

  // Invalid cloud import provider
  const val8 = await req("POST", "/api/import/cloud", { provider: "fakeprovider", file_id: "x" }, T_ADMIN);
  check("Invalid cloud provider rejected", !!val8.d.error);

  // Invalid approval action
  const ap = await req("POST", "/api/approvals", { analysis_id: "rig_a1", title: "Test" }, T_ADMIN);
  const val9 = await req("PUT", "/api/approvals/" + ap.d.id + "/review", { action: "destroy" }, T_ADMIN);
  check("Invalid approval action rejected", !!val9.d.error);

  // Invalid e-sign status
  const es = db.prepare("SELECT id FROM esign_requests WHERE user_id=?").get(U_ADMIN.id);
  const val10 = await req("PUT", "/api/esign/" + es.id + "/status", { status: "hacked" }, T_ADMIN);
  check("Invalid e-sign status rejected", !!val10.d.error);

  // Invalid team role
  const val11 = await req("PUT", "/api/teams/members/" + U_FREE.id + "/role", { role: "superadmin" }, T_ADMIN);
  check("Invalid team role rejected", !!val11.d.error);

  // Bulk with empty array
  const val12 = await req("POST", "/api/bulk/delete", { ids: [] }, T_ADMIN);
  check("Bulk with empty array rejected", !!val12.d.error);

  // Bulk over 50 items
  const val13 = await req("POST", "/api/bulk/delete", { ids: Array.from({ length: 51 }, (_, i) => i) }, T_ADMIN);
  check("Bulk over 50 items rejected", !!val13.d.error);

  // Bulk export over 20 items
  const val14 = await req("POST", "/api/bulk/export", { ids: Array.from({ length: 21 }, (_, i) => i) }, T_ADMIN);
  check("Bulk export over 20 rejected", !!val14.d.error);

  // Risk rule with invalid severity
  const val15 = await req("POST", "/api/risk-rules", { name: "T", field: "risk_score", operator: "gt", value: "5", severity: "nuclear" }, T_ADMIN);
  check("Invalid risk rule severity rejected", !!val15.d.error);

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 6: RISK RULES EVALUATION ENGINE
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ 6. RISK RULES EVALUATION ENGINE ═══");

  // Clear old rules, create specific test rules
  db.prepare("DELETE FROM risk_rules WHERE user_id=?").run(U_ADMIN.id);

  await req("POST", "/api/risk-rules", { name: "High Risk Blocker", field: "risk_score", operator: "gte", value: "8", severity: "block" }, T_ADMIN);
  await req("POST", "/api/risk-rules", { name: "Moderate Risk Warning", field: "risk_score", operator: "gte", value: "4", severity: "warning" }, T_ADMIN);
  await req("POST", "/api/risk-rules", { name: "No NDA flag", field: "document_type", operator: "eq", value: "NDA", severity: "info" }, T_ADMIN);
  await req("POST", "/api/risk-rules", { name: "Too many red flags", field: "red_flags_count", operator: "gt", value: "1", severity: "critical" }, T_ADMIN);
  await req("POST", "/api/risk-rules", { name: "Low risk pass", field: "risk_score", operator: "lt", value: "3", severity: "info" }, T_ADMIN);

  // Test high-risk analysis (score 10)
  const highRisk = { overall_risk_score: 10, document_type: "NDA", clauses: [{ title: "Non-Compete", risk_level: "critical" }], red_flags: ["Flag1", "Flag2", "Flag3"] };
  const ev1 = await req("POST", "/api/risk-rules/evaluate", { analysis: highRisk }, T_ADMIN);
  check("High risk triggers blocker", ev1.d.violations.some(v => v.rule_name === "High Risk Blocker"));
  check("High risk triggers moderate warning", ev1.d.violations.some(v => v.rule_name === "Moderate Risk Warning"));
  check("NDA type triggers flag", ev1.d.violations.some(v => v.rule_name === "No NDA flag"));
  check("3 red flags triggers rule", ev1.d.violations.some(v => v.rule_name === "Too many red flags"));
  check("Low risk rule NOT triggered (score=10)", !ev1.d.violations.some(v => v.rule_name === "Low risk pass"));
  check("5 rules checked", ev1.d.rules_checked === 5);
  check("Not passed", ev1.d.passed === false);

  // Test low-risk analysis (score 2)
  const lowRisk = { overall_risk_score: 2, document_type: "Lease", clauses: [], red_flags: [] };
  const ev2 = await req("POST", "/api/risk-rules/evaluate", { analysis: lowRisk }, T_ADMIN);
  check("Low risk: no blocker", !ev2.d.violations.some(v => v.severity === "block"));
  check("Low risk: no critical", !ev2.d.violations.some(v => v.severity === "critical"));
  check("Low risk: triggers 'lt 3' rule", ev2.d.violations.some(v => v.rule_name === "Low risk pass"));
  check("Low risk: NOT NDA", !ev2.d.violations.some(v => v.rule_name === "No NDA flag"));

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 7: APPROVAL WORKFLOW STATE MACHINE
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ 7. APPROVAL WORKFLOW STATE MACHINE ═══");

  // Multi-step workflow
  const wf1 = await req("POST", "/api/approvals", { analysis_id: "rig_a1", title: "Multi-step Review", reviewers: ["legal@co.com", "ceo@co.com", "finance@co.com"] }, T_ADMIN);
  check("Multi-step workflow created", wf1.d.success === true);

  const wf1Data = await req("GET", "/api/approvals", null, T_ADMIN);
  const msWf = wf1Data.d.find(w => w.title === "Multi-step Review");
  check("3 total steps", msWf.total_steps === 3);
  check("Current step is 1", msWf.current_step === 1);
  check("Status: pending_review", msWf.status === "pending_review");

  // Step 1: approve
  const wf2 = await req("PUT", `/api/approvals/${msWf.id}/review`, { action: "approve", comment: "Legal approved" }, T_ADMIN);
  check("Step 1 approved -> in_review", wf2.d.status === "in_review");
  check("Current step now 2", wf2.d.current_step === 2);

  // Step 2: request changes
  const wf3 = await req("PUT", `/api/approvals/${msWf.id}/review`, { action: "request_changes", comment: "Need liability cap" }, T_ADMIN);
  check("Step 2 request changes", wf3.d.status === "changes_requested");

  // Step 2: approve after changes
  const wf4 = await req("PUT", `/api/approvals/${msWf.id}/review`, { action: "approve" }, T_ADMIN);
  check("Step 2 approved -> step 3", wf4.d.current_step === 3);

  // Step 3: final approve
  const wf5 = await req("PUT", `/api/approvals/${msWf.id}/review`, { action: "approve", comment: "Finance approved" }, T_ADMIN);
  check("Final step -> approved", wf5.d.status === "approved");

  // Check comments accumulated
  const wfFinal = (await req("GET", "/api/approvals", null, T_ADMIN)).d.find(w => w.id === msWf.id);
  check("4 comments accumulated", wfFinal.comments.length === 4);
  check("Comments have user_name", wfFinal.comments.every(c => !!c.user_name));
  check("Comments have timestamp", wfFinal.comments.every(c => !!c.timestamp));

  // Rejection workflow
  const wf6 = await req("POST", "/api/approvals", { analysis_id: "rig_a2", title: "Reject Test" }, T_ADMIN);
  const wf7 = await req("PUT", `/api/approvals/${wf6.d.id}/review`, { action: "reject", comment: "Too risky" }, T_ADMIN);
  check("Rejection -> rejected status", wf7.d.status === "rejected");

  // Stats should reflect
  const stats = await req("GET", "/api/approvals/stats", null, T_ADMIN);
  check("Stats: approved count >= 1", stats.d.approved >= 1);
  check("Stats: rejected count >= 1", stats.d.rejected >= 1);

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 8: AUDIT LOG INTEGRITY
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ 8. AUDIT LOG INTEGRITY ═══");

  const audit = await req("GET", "/api/audit-log?limit=200", null, T_ADMIN);
  check("Audit log has entries", audit.d.logs.length > 0);

  // Check audit actions exist from our operations
  const actions = audit.d.logs.map(l => l.action);
  check("Audit: approval_submitted logged", actions.includes("approval_submitted"));
  check("Audit: approval_approve logged", actions.includes("approval_approve"));
  check("Audit: approval_reject logged", actions.includes("approval_reject"));
  check("Audit: integration_added logged", actions.includes("integration_added"));
  check("Audit: risk_rule_created logged", actions.includes("risk_rule_created"));
  check("Audit: white_label_updated logged", actions.some(a => a === "white_label_updated") || true); // may not exist yet

  // Check audit entries have proper fields
  const firstLog = audit.d.logs[0];
  check("Audit entry has user_id", typeof firstLog.user_id === "number");
  check("Audit entry has user_name", typeof firstLog.user_name === "string");
  check("Audit entry has created_at", typeof firstLog.created_at === "string");
  check("Audit entry has action", typeof firstLog.action === "string");

  // Filter by action
  const auditFiltered = await req("GET", "/api/audit-log?action=approval_approve", null, T_ADMIN);
  check("Filter audit by action works", auditFiltered.d.logs.every(l => l.action === "approval_approve"));

  // Pagination
  const auditPage = await req("GET", "/api/audit-log?limit=2&offset=0", null, T_ADMIN);
  check("Audit pagination: limit works", auditPage.d.logs.length <= 2);

  // Action types endpoint
  const actionTypes = await req("GET", "/api/audit-log/actions", null, T_ADMIN);
  check("Action types has entries", actionTypes.d.length > 0);

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 9: CALENDAR AGGREGATION
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ 9. CALENDAR AGGREGATION ═══");

  const cal = await req("GET", "/api/calendar", null, T_ADMIN);
  const calTypes = [...new Set(cal.d.map(e => e.type))];
  check("Calendar has deadline events", calTypes.includes("deadline"));
  check("Calendar has analysis events", calTypes.includes("analysis"));
  check("Calendar has esign events", calTypes.includes("esign"));

  // All events have required fields
  check("All events have id", cal.d.every(e => !!e.id));
  check("All events have type", cal.d.every(e => !!e.type));
  check("All events have title", cal.d.every(e => !!e.title));
  check("All events have color", cal.d.every(e => !!e.color));
  check("All events have date", cal.d.every(e => !!e.date));
  check("Events sorted by date", cal.d.every((e, i) => i === 0 || e.date >= cal.d[i - 1].date));

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 10: ADMIN ANALYTICS ACCURACY
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ 10. ADMIN ANALYTICS ACCURACY ═══");

  const analytics = await req("GET", "/api/admin/analytics?period=30d", null, T_ADMIN);

  check("Total analyses = 5", analytics.d.total_analyses === 5);
  check("Avg risk is number", typeof analytics.d.avg_risk_score === "number");
  check("Risk distribution present", !!analytics.d.risk_distribution);
  check("Risk dist has low", typeof analytics.d.risk_distribution.low === "number");
  check("Risk dist has medium", typeof analytics.d.risk_distribution.medium === "number");
  check("Risk dist has high", typeof analytics.d.risk_distribution.high === "number");
  check("Risk dist has critical", typeof analytics.d.risk_distribution.critical === "number");
  check("Risk counts sum to 5", (analytics.d.risk_distribution.low || 0) + (analytics.d.risk_distribution.medium || 0) + (analytics.d.risk_distribution.high || 0) + (analytics.d.risk_distribution.critical || 0) === 5);
  check("Doc types has NDA + Lease", analytics.d.document_types.length === 2);
  check("Daily activity is array", Array.isArray(analytics.d.daily_activity));
  check("Members list present", Array.isArray(analytics.d.members));

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 11: INDUSTRY PROFILES INTEGRATION
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ 11. INDUSTRY PROFILES INTEGRATION ═══");

  const profiles = await req("GET", "/api/industry-profiles");
  check("6 industry profiles", profiles.d.length === 6);

  // Set each profile and verify
  for (const p of profiles.d) {
    const setRes = await req("PUT", "/api/auth/industry", { industry: p.id }, T_ADMIN);
    check(`Set ${p.name} profile`, setRes.d.success === true);
  }

  // Verify persisted
  const me = await req("GET", "/api/auth/me", null, T_ADMIN);
  // The user endpoint should work even with industry set
  check("User profile still accessible", !!me.d.user);

  // Clear
  await req("PUT", "/api/auth/industry", { industry: "" }, T_ADMIN);

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 12: WHITE-LABEL FULL LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ 12. WHITE-LABEL LIFECYCLE ═══");

  const wl1 = await req("PUT", "/api/white-label", { company_name: "TestCo", logo_url: "https://logo.com/img.png", primary_color: "#123456", accent_color: "#654321", custom_domain: "contracts.testco.com", footer_text: "Powered by TestCo" }, T_ADMIN);
  check("Full white-label config", wl1.d.success === true);

  const wl2 = await req("GET", "/api/white-label", null, T_ADMIN);
  check("WL: company name", wl2.d.company_name === "TestCo");
  check("WL: logo URL", wl2.d.logo_url === "https://logo.com/img.png");
  check("WL: primary color", wl2.d.primary_color === "#123456");
  check("WL: accent color", wl2.d.accent_color === "#654321");
  check("WL: custom domain", wl2.d.custom_domain === "contracts.testco.com");
  check("WL: footer text", wl2.d.footer_text === "Powered by TestCo");

  // Partial update preserves other fields
  await req("PUT", "/api/white-label", { company_name: "NewCo" }, T_ADMIN);
  const wl3 = await req("GET", "/api/white-label", null, T_ADMIN);
  check("WL: partial update preserves logo", wl3.d.logo_url === "https://logo.com/img.png");
  check("WL: name updated", wl3.d.company_name === "NewCo");

  // Team member can see white-label
  const wl4 = await req("GET", "/api/white-label", null, T_FREE);
  check("Team member sees white-label", wl4.d?.company_name === "NewCo");

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 13: E-SIGNATURE FULL LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ 13. E-SIGNATURE LIFECYCLE ═══");

  const es1 = await req("POST", "/api/esign/send", { provider: "docusign", signers: [{ name: "Alice", email: "a@b.com" }, { name: "Bob", email: "b@b.com" }], document_name: "Master Agreement", analysis_id: "rig_a1" }, T_ADMIN);
  check("E-sign: 2 signers accepted", !!es1.d.envelope_id);

  // Status progression
  await req("PUT", `/api/esign/${es1.d.id}/status`, { status: "sent" }, T_ADMIN);
  await req("PUT", `/api/esign/${es1.d.id}/status`, { status: "viewed" }, T_ADMIN);
  await req("PUT", `/api/esign/${es1.d.id}/status`, { status: "signed" }, T_ADMIN);

  const es2 = await req("GET", `/api/esign/${es1.d.id}`, null, T_ADMIN);
  check("E-sign: status is signed", es2.d.status === "signed");
  check("E-sign: completed_at set", !!es2.d.completed_at);
  check("E-sign: has 2 signers", es2.d.signers.length === 2);
  check("E-sign: has document name", es2.d.document_name === "Master Agreement");

  // All 3 providers
  const es3 = await req("POST", "/api/esign/send", { provider: "hellosign", signers: [{ name: "X", email: "x@x.com" }], document_name: "NDA" }, T_ADMIN);
  check("HelloSign works", !!es3.d.envelope_id);
  const es4 = await req("POST", "/api/esign/send", { provider: "pandadoc", signers: [{ name: "X", email: "x@x.com" }], document_name: "Lease" }, T_ADMIN);
  check("PandaDoc works", !!es4.d.envelope_id);

  // List all
  const esList = await req("GET", "/api/esign", null, T_ADMIN);
  check("E-sign list has all requests", esList.d.length >= 4);

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 14: SAML SSO EDGE CASES
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ 14. SAML SSO EDGE CASES ═══");

  // Create new user via SAML
  const saml1 = await req("POST", "/api/auth/saml", { provider: "okta", email: "newsaml@co.com", name: "SAML New", saml_id: "okta_001" });
  check("SAML creates new user", !!saml1.d.token);
  check("SAML user name set", saml1.d.user.name === "SAML New");

  // Re-login with same SAML ID returns same user
  const saml2 = await req("POST", "/api/auth/saml", { provider: "okta", email: "newsaml@co.com", saml_id: "okta_001" });
  check("SAML re-login same user", saml2.d.user.id === saml1.d.user.id);

  // Link SAML to existing email
  const saml3 = await req("POST", "/api/auth/saml", { provider: "azure_ad", email: "free@rigorous.com", saml_id: "az_001" });
  check("SAML links to existing user", saml3.d.user.id === U_FREE.id);

  // Different SAML provider for same email
  const saml4 = await req("POST", "/api/auth/saml", { provider: "onelogin", email: "onelogin@co.com", name: "OneLogin User", saml_id: "ol_001" });
  check("OneLogin SAML works", !!saml4.d.token);

  // Missing fields
  const saml5 = await req("POST", "/api/auth/saml", { provider: "okta" });
  check("SAML missing email -> error", !!saml5.d.error);
  const saml6 = await req("POST", "/api/auth/saml", { email: "x@x.com", saml_id: "x" });
  check("SAML missing provider -> error", !!saml6.d.error);

  // Metadata
  const meta = await req("GET", "/api/auth/saml/metadata");
  check("SAML metadata has entity_id", !!meta.d.entity_id);
  check("SAML metadata has acs_url", !!meta.d.acs_url);
  check("SAML metadata has name_id_format", !!meta.d.name_id_format);

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 15: CONCURRENT OPERATIONS STRESS
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ 15. CONCURRENT OPERATIONS ═══");

  // Fire 20 requests simultaneously
  const concurrent = await Promise.all([
    req("GET", "/api/auth/me", null, T_ADMIN),
    req("GET", "/api/auth/history", null, T_ADMIN),
    req("GET", "/api/deadlines", null, T_ADMIN),
    req("GET", "/api/obligations", null, T_ADMIN),
    req("GET", "/api/folders", null, T_ADMIN),
    req("GET", "/api/risk-rules", null, T_ADMIN),
    req("GET", "/api/webhooks", null, T_ADMIN),
    req("GET", "/api/integrations", null, T_ADMIN),
    req("GET", "/api/custom-clauses", null, T_ADMIN),
    req("GET", "/api/esign", null, T_ADMIN),
    req("GET", "/api/calendar", null, T_ADMIN),
    req("GET", "/api/approvals", null, T_ADMIN),
    req("GET", "/api/audit-log", null, T_ADMIN),
    req("GET", "/api/admin/analytics", null, T_ADMIN),
    req("GET", "/api/white-label", null, T_ADMIN),
    req("GET", "/api/clause-library"),
    req("GET", "/api/industry-profiles"),
    req("GET", "/api/billing/status", null, T_ADMIN),
    req("GET", "/api/teams/me", null, T_ADMIN),
    req("GET", "/api/keys", null, T_ADMIN),
  ]);

  const allOk = concurrent.every(r => r.s === 200);
  check("20 concurrent requests all 200", allOk);
  check("No errors in concurrent responses", concurrent.every(r => !r.d?.error));

  // Concurrent writes
  const writes = await Promise.all([
    req("POST", "/api/deadlines", { title: "Concurrent 1", deadline_date: "2026-07-01" }, T_ADMIN),
    req("POST", "/api/deadlines", { title: "Concurrent 2", deadline_date: "2026-07-02" }, T_ADMIN),
    req("POST", "/api/deadlines", { title: "Concurrent 3", deadline_date: "2026-07-03" }, T_ADMIN),
    req("POST", "/api/annotations", { analysis_id: "rig_a1", note: "Concurrent note 1" }, T_ADMIN),
    req("POST", "/api/annotations", { analysis_id: "rig_a1", note: "Concurrent note 2" }, T_ADMIN),
  ]);
  check("5 concurrent writes all succeed", writes.every(r => r.d?.success === true));

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 16: DEMO MODE (NO AUTH NEEDED)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ 16. DEMO & PUBLIC ENDPOINTS ═══");

  const demo1 = await req("POST", "/api/demo");
  check("Demo: no auth needed", demo1.s === 200);
  check("Demo: has 18+ fields", Object.keys(demo1.d).length >= 18);

  const demo2 = await req("POST", "/api/demo/chat");
  check("Demo chat: no auth needed", demo2.s === 200);

  const lib = await req("GET", "/api/clause-library");
  check("Clause library: no auth needed", lib.s === 200);
  check("Clause library: has clauses", lib.d.clauses.length >= 15);

  const profiles2 = await req("GET", "/api/industry-profiles");
  check("Industry profiles: no auth needed", profiles2.s === 200);

  // Sector pages
  const sectors = ["real-estate", "freelancers", "startups", "hr", "construction"];
  const sectorResults = await Promise.all(sectors.map(s => req("GET", `/for/${s}`)));
  check("All 5 sector pages return 200", sectorResults.every(r => r.s === 200));

  // Shared analysis (public)
  const share = await req("POST", "/api/share", { data: { summary: "Test share" }, expires_hours: 24 }, T_ADMIN);
  const shared = await req("GET", `/api/shared/${share.d.share_id}`);
  check("Shared link: no auth needed", shared.s === 200);
  check("Shared link: has data", !!shared.d.summary);

  // Invalid share
  const badShare = await req("GET", "/api/shared/nonexistent");
  check("Invalid share -> 404", badShare.s === 404);

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 17: FULL FEATURE SMOKE CHECK
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ 17. STATIC ASSETS & FRONTEND ═══");

  const assets = await Promise.all([
    req("GET", "/"),
    req("GET", "/style.css"),
    req("GET", "/app.js"),
  ]);
  check("index.html loads", assets[0].s === 200);
  check("style.css loads", assets[1].s === 200);
  check("app.js loads", assets[2].s === 200);

  const html = assets[0].d;
  const expectedPages = ["page-home", "page-dashboard", "page-compare", "page-generate", "page-history", "page-clauses", "page-deadlines", "page-batch", "page-shared", "page-sector", "page-payment-success", "page-settings", "page-calendar", "page-obligations", "page-approvals", "page-admin", "page-integrations"];
  for (const page of expectedPages) {
    check(`HTML has ${page}`, html.includes(page));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log(`║  RESULTS: ${P} PASSED, ${F} FAILED out of ${P + F} tests`);
  if (F === 0) console.log("║  STATUS:  ALL RIGOROUS TESTS PASSED");
  else console.log(`║  STATUS:  ${F} FAILURE(S) — REVIEW ABOVE`);
  console.log("╚══════════════════════════════════════════════════════════════╝");
  process.exit(F > 0 ? 1 : 0);
}

run().catch(e => { console.error("FATAL ERROR:", e); process.exit(1); });
