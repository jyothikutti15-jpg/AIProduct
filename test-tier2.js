const http = require("http");
const otplib = require("otplib");

const BASE = "http://localhost:3001";
let P = 0, F = 0, T1 = null, T2 = null;

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
  console.log("╔═══════════════════════════════════════════════════════╗");
  console.log("║     TIER 2 FEATURE TESTS (6 Features)                ║");
  console.log("╠═══════════════════════════════════════════════════════╣\n");

  // Setup users
  const s1 = await req("POST", "/api/auth/signup", { name: "Alice Admin", email: "alice@corp.com", password: "password123" });
  T1 = s1.d.token;
  const s2 = await req("POST", "/api/auth/signup", { name: "Bob Member", email: "bob@corp.com", password: "password123" });
  T2 = s2.d.token;

  // ═══ 1. TEAM WORKSPACES ═══
  console.log("═══ 1. TEAM WORKSPACES ═══");

  const t1 = await req("POST", "/api/teams", { name: "Acme Legal Team" }, T1);
  check("Create team", t1.d.success === true);

  const ti = await req("GET", "/api/teams/me", null, T1);
  check("Team name correct", ti.d.team?.name === "Acme Legal Team");
  check("Alice is member", ti.d.members?.length === 1);
  check("Alice is admin", ti.d.my_role === "admin");

  const inv = await req("POST", "/api/teams/invite", { email: "bob@corp.com", role: "member" }, T1);
  check("Invite Bob", !!inv.d.invite_code);

  const join = await req("POST", "/api/teams/join/" + inv.d.invite_code, null, T2);
  check("Bob joins team", join.d.success === true);

  const ti2 = await req("GET", "/api/teams/me", null, T1);
  check("Team has 2 members", ti2.d.members?.length === 2);

  const cr = await req("PUT", "/api/teams/members/" + s2.d.user.id + "/role", { role: "viewer" }, T1);
  check("Change Bob to viewer", cr.d.success === true);

  const ni = await req("POST", "/api/teams/invite", { email: "x@x.com" }, T2);
  check("Non-admin can't invite", !!ni.d.error);

  const ta = await req("GET", "/api/teams/analyses", null, T1);
  check("Team analyses endpoint", Array.isArray(ta.d));

  // ═══ 2. API KEYS ═══
  console.log("\n═══ 2. DEVELOPER API KEYS ═══");

  const k1 = await req("POST", "/api/keys", { name: "Test" }, T1);
  check("Free plan blocks API keys", k1.d.error?.includes("Enterprise"));

  // Upgrade Alice to enterprise
  const db = require("./lib/db");
  db.prepare("UPDATE users SET plan = 'enterprise' WHERE email = 'alice@corp.com'").run();
  // Re-login to get new token
  const l2 = await req("POST", "/api/auth/login", { email: "alice@corp.com", password: "password123" });
  T1 = l2.d.token;

  const k2 = await req("POST", "/api/keys", { name: "Production Key" }, T1);
  check("Enterprise creates key", k2.d.key?.startsWith("csk_"));
  check("Key prefix masked", k2.d.prefix?.includes("..."));

  const kl = await req("GET", "/api/keys", null, T1);
  check("List shows 1 key", kl.d.length === 1);
  check("Name is Production Key", kl.d[0]?.name === "Production Key");

  const kd = await req("DELETE", "/api/keys/" + kl.d[0]?.id, null, T1);
  check("Delete key", kd.d.success === true);

  // ═══ 3. VERSION TRACKING ═══
  console.log("\n═══ 3. CONTRACT VERSION TRACKING ═══");

  // Insert test analyses
  db.prepare("INSERT INTO analyses (user_id,analysis_id,filename,document_type,risk_score,risk_label,data) VALUES (?,?,?,?,?,?,?)")
    .run(1, "a1", "contract_v1.pdf", "NDA", 7, "High Risk", JSON.stringify({ summary: "V1", clauses: [{ title: "Non-Compete", risk_level: "critical" }, { title: "Indemnification", risk_level: "high" }], red_flags: ["Flag 1", "Flag 2"] }));
  db.prepare("INSERT INTO analyses (user_id,analysis_id,filename,document_type,risk_score,risk_label,data) VALUES (?,?,?,?,?,?,?)")
    .run(1, "a2", "contract_v2.pdf", "NDA", 4, "Moderate Risk", JSON.stringify({ summary: "V2 improved", clauses: [{ title: "Non-Compete", risk_level: "medium" }, { title: "Indemnification", risk_level: "low" }, { title: "Arbitration", risk_level: "low" }], red_flags: ["Flag 1"] }));

  const vg = await req("POST", "/api/versions/create-group", { analysis_id: "a1" }, T1);
  check("Create version group", !!vg.d.version_group);

  const va = await req("PUT", "/api/versions/a2/assign", { version_group: vg.d.version_group }, T1);
  check("Assign v2 to group", va.d.version_number === 2);

  const vl = await req("GET", "/api/versions/" + vg.d.version_group, null, T1);
  check("List versions (2)", vl.d.length === 2);
  check("V1 is version 1", vl.d[0]?.version_number === 1);
  check("V2 is version 2", vl.d[1]?.version_number === 2);

  const vc = await req("GET", "/api/versions/" + vg.d.version_group + "/compare", null, T1);
  check("Compare: risk improved", vc.d.risk_improved === true);
  check("Compare: risk change = -3", vc.d.risk_change === -3);
  check("Compare: clause changes detected", vc.d.clause_changes?.length >= 2);
  check("Compare: resolved red flags", vc.d.resolved_red_flags?.length >= 1);
  check("Compare: new clause (Arbitration) added", vc.d.clause_changes?.some(c => c.title === "Arbitration" && c.type === "added"));
  check("Compare: Non-Compete improved", vc.d.clause_changes?.some(c => c.title === "Non-Compete" && c.improved));

  // ═══ 4. WEBHOOKS ═══
  console.log("\n═══ 4. WEBHOOK INTEGRATIONS ═══");

  const w1 = await req("POST", "/api/webhooks", { url: "https://hooks.slack.com/xxx", events: ["analysis_complete", "deadline_alert"] }, T1);
  check("Create webhook", w1.d.secret?.startsWith("whsec_"));
  check("Returns signing secret", w1.d.secret?.length > 20);

  const wl = await req("GET", "/api/webhooks", null, T1);
  check("List webhooks (1)", wl.d.length === 1);
  check("Has 2 events", wl.d[0]?.events?.length === 2);
  check("Is active", wl.d[0]?.is_active === 1);

  const wt = await req("PUT", "/api/webhooks/" + wl.d[0]?.id + "/toggle", null, T1);
  check("Toggle webhook", wt.d.success === true);

  const we = await req("POST", "/api/webhooks", { url: "https://x.com", events: ["fake_event"] }, T1);
  check("Invalid events rejected", !!we.d.error);
  check("Valid events listed", we.d.valid?.length === 4);

  const wn = await req("POST", "/api/webhooks", {}, T1);
  check("Missing fields rejected", !!wn.d.error);

  await req("DELETE", "/api/webhooks/" + wl.d[0]?.id, null, T1);

  // ═══ 5. CUSTOM CLAUSES ═══
  console.log("\n═══ 5. CUSTOM CLAUSE LIBRARY ═══");

  const cc1 = await req("POST", "/api/custom-clauses", { category: "IP Rights", title: "Our IP Clause", text: "All work product belongs to Client." }, T1);
  check("Add custom clause", cc1.d.success === true);

  const cc2 = await req("POST", "/api/custom-clauses", { category: "Termination", title: "Team Standard", text: "30 days notice.", share_with_team: true }, T1);
  check("Add team clause", cc2.d.success === true);

  const ccl = await req("GET", "/api/custom-clauses", null, T1);
  check("List custom (2)", ccl.d.length === 2);

  const ccu = await req("PUT", "/api/custom-clauses/" + cc1.d.id, { title: "Updated IP" }, T1);
  check("Update clause", ccu.d.success === true);

  const ccd = await req("DELETE", "/api/custom-clauses/" + cc1.d.id, null, T1);
  check("Delete clause", ccd.d.success === true);

  const ccl2 = await req("GET", "/api/custom-clauses", null, T1);
  check("Now has 1 clause", ccl2.d.length === 1);

  const cce = await req("POST", "/api/custom-clauses", {}, T1);
  check("Missing fields rejected", !!cce.d.error);

  // ═══ 6. TWO-FACTOR AUTH ═══
  console.log("\n═══ 6. TWO-FACTOR AUTHENTICATION ═══");

  const fa1 = await req("POST", "/api/auth/2fa/setup", null, T1);
  check("Setup returns QR code", fa1.d.qr?.startsWith("data:image"));
  check("Setup returns secret (32 chars)", fa1.d.secret?.length === 32);
  check("Setup returns 8 backup codes", fa1.d.backup_codes?.length === 8);

  // Verify with correct TOTP
  const totp1 = otplib.generateSync({secret:fa1.d.secret});
  const fa2 = await req("POST", "/api/auth/2fa/verify", { token: totp1 }, T1);
  check("Verify with valid TOTP", fa2.d.success === true);

  // Login now requires 2FA
  const fa3 = await req("POST", "/api/auth/login-2fa", { email: "alice@corp.com", password: "password123" });
  check("Login without 2FA -> requires_2fa", fa3.d.requires_2fa === true);

  // Login with TOTP
  const totp2 = otplib.generateSync({secret:fa1.d.secret});
  const fa4 = await req("POST", "/api/auth/login-2fa", { email: "alice@corp.com", password: "password123", totp_token: totp2 });
  check("Login with TOTP -> success", !!fa4.d.token);

  // Login with backup code
  const fa5 = await req("POST", "/api/auth/login-2fa", { email: "alice@corp.com", password: "password123", backup_code: fa1.d.backup_codes[0] });
  check("Login with backup code -> success", !!fa5.d.token);

  // Wrong TOTP
  const fa6 = await req("POST", "/api/auth/login-2fa", { email: "alice@corp.com", password: "password123", totp_token: "000000" });
  check("Wrong TOTP rejected", !!fa6.d.error);

  // Wrong password still rejected
  const fa7 = await req("POST", "/api/auth/login-2fa", { email: "alice@corp.com", password: "wrong" });
  check("Wrong password rejected", fa7.s === 401);

  // Duplicate setup blocked
  const fa8 = await req("POST", "/api/auth/2fa/setup", null, T1);
  check("Double setup blocked", !!fa8.d.error);

  // ═══ SUMMARY ═══
  console.log("\n╠═══════════════════════════════════════════════════════╣");
  console.log(`║  RESULTS: ${P} PASSED, ${F} FAILED out of ${P + F} tests`);
  if (F === 0) console.log("║  STATUS:  ALL TIER 2 TESTS PASSED");
  else console.log(`║  STATUS:  ${F} FAILURE(S)`);
  console.log("╚═══════════════════════════════════════════════════════╝");
  process.exit(F > 0 ? 1 : 0);
}

run().catch(e => { console.error("ERROR:", e); process.exit(1); });
