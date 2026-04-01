const nodemailer = require("nodemailer");
const db = require("./db");

let transporter = null;

if (process.env.SMTP_HOST) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

const FROM = process.env.EMAIL_FROM || "ContractShield AI <noreply@contractshield.ai>";
const APP_URL = process.env.APP_URL || "http://localhost:3001";

function logoHeader() {
  return `<div style="text-align:center;padding:20px 0;border-bottom:2px solid #4f46e5"><h1 style="margin:0;color:#4f46e5;font-family:Arial,sans-serif">&#x1f6e1; ContractShield AI</h1></div>`;
}

async function send(to, subject, html) {
  if (!transporter) { console.log("[Email] SMTP not configured, skipping:", subject); return false; }
  try {
    await transporter.sendMail({ from: FROM, to, subject, html });
    return true;
  } catch (e) {
    console.error("[Email] Send failed:", e.message);
    return false;
  }
}

function logEmail(userId, type, subject) {
  db.prepare("INSERT INTO email_log (user_id, email_type, subject) VALUES (?, ?, ?)").run(userId, type, subject);
}

// ── Notification types ──────────────────────────────────────────────────────

async function sendWelcome(user) {
  if (!user.email_notifications) return;
  const subject = "Welcome to ContractShield AI!";
  const html = `${logoHeader()}
    <div style="padding:30px;font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto">
      <h2>Welcome, ${user.name}!</h2>
      <p>Your account is ready. Here's what you can do:</p>
      <ul>
        <li><strong>Upload a contract</strong> — get a full risk analysis in 30 seconds</li>
        <li><strong>Ask AI questions</strong> — chat about any clause or risk</li>
        <li><strong>Compare contracts</strong> — find the better deal side-by-side</li>
        <li><strong>Generate templates</strong> — create professional contracts from scratch</li>
      </ul>
      <div style="text-align:center;margin:30px 0">
        <a href="${APP_URL}" style="background:#4f46e5;color:#fff;padding:12px 30px;border-radius:8px;text-decoration:none;font-weight:600">Start Analyzing</a>
      </div>
      <p style="color:#666;font-size:13px">You're on the Free plan (3 analyses/month). <a href="${APP_URL}/#pricing">Upgrade for more.</a></p>
    </div>`;
  const sent = await send(user.email, subject, html);
  if (sent) logEmail(user.id, "welcome", subject);
}

async function sendAnalysisComplete(user, analysis) {
  if (!user.email_notifications) return;
  const riskColor = analysis.overall_risk_score <= 3 ? "#16a34a" : analysis.overall_risk_score <= 5 ? "#f59e0b" : "#dc2626";
  const subject = `Analysis Complete: ${analysis.filename} (Risk: ${analysis.overall_risk_score}/10)`;
  const html = `${logoHeader()}
    <div style="padding:30px;font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto">
      <h2>Contract Analysis Complete</h2>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin:20px 0">
        <p style="margin:0"><strong>File:</strong> ${analysis.filename}</p>
        <p style="margin:5px 0"><strong>Type:</strong> ${analysis.document_type || "N/A"}</p>
        <p style="margin:5px 0"><strong>Risk Score:</strong> <span style="color:${riskColor};font-weight:700;font-size:1.2em">${analysis.overall_risk_score}/10</span> (${analysis.overall_risk_label})</p>
        <p style="margin:5px 0"><strong>Clauses:</strong> ${analysis.clauses?.length || 0} analyzed</p>
        <p style="margin:5px 0"><strong>Red Flags:</strong> ${analysis.red_flags?.length || 0}</p>
      </div>
      ${analysis.red_flags?.length > 0 ? `<h3 style="color:#dc2626">&#x1f6a8; Red Flags</h3><ul>${analysis.red_flags.slice(0, 3).map(f => `<li>${f}</li>`).join("")}</ul>` : ""}
      <div style="text-align:center;margin:30px 0">
        <a href="${APP_URL}" style="background:#4f46e5;color:#fff;padding:12px 30px;border-radius:8px;text-decoration:none;font-weight:600">View Full Analysis</a>
      </div>
    </div>`;
  const sent = await send(user.email, subject, html);
  if (sent) logEmail(user.id, "analysis_complete", subject);
}

async function sendDeadlineAlert(user, deadline) {
  if (!user.email_deadline_alerts) return;
  const daysLeft = Math.ceil((new Date(deadline.deadline_date) - new Date()) / 86400000);
  const urgency = daysLeft <= 0 ? "OVERDUE" : daysLeft <= 7 ? "URGENT" : "UPCOMING";
  const subject = `[${urgency}] Contract Deadline: ${deadline.title} - ${daysLeft <= 0 ? Math.abs(daysLeft) + " days overdue" : daysLeft + " days left"}`;
  const html = `${logoHeader()}
    <div style="padding:30px;font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto">
      <h2 style="color:${daysLeft <= 7 ? '#dc2626' : '#f59e0b'}">&#x23f0; Deadline Alert</h2>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin:20px 0">
        <p style="margin:0;font-size:1.2em"><strong>${deadline.title}</strong></p>
        <p style="margin:5px 0"><strong>Contract:</strong> ${deadline.contract_name || "N/A"}</p>
        <p style="margin:5px 0"><strong>Deadline:</strong> ${new Date(deadline.deadline_date).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
        <p style="margin:5px 0;font-size:1.3em;font-weight:700;color:${daysLeft <= 0 ? '#dc2626' : daysLeft <= 7 ? '#f59e0b' : '#16a34a'}">${daysLeft <= 0 ? Math.abs(daysLeft) + " days overdue!" : daysLeft + " days remaining"}</p>
        ${deadline.is_auto_renewal ? '<p style="margin:5px 0;color:#f59e0b"><strong>⚠ Auto-renewal contract</strong></p>' : ""}
        ${deadline.notes ? `<p style="margin:5px 0;color:#666"><em>${deadline.notes}</em></p>` : ""}
      </div>
      <div style="text-align:center;margin:30px 0">
        <a href="${APP_URL}" style="background:#4f46e5;color:#fff;padding:12px 30px;border-radius:8px;text-decoration:none;font-weight:600">View Deadlines</a>
      </div>
    </div>`;
  const sent = await send(user.email, subject, html);
  if (sent) logEmail(user.id, "deadline_alert", subject);
}

async function sendWeeklyDigest(user) {
  if (!user.email_weekly_digest) return;

  const analyses = db.prepare(
    "SELECT * FROM analyses WHERE user_id = ? AND created_at >= datetime('now', '-7 days') ORDER BY created_at DESC"
  ).all(user.id);

  const deadlines = db.prepare(
    "SELECT * FROM contract_deadlines WHERE user_id = ? AND status = 'active' AND deadline_date <= date('now', '+30 days') ORDER BY deadline_date"
  ).all(user.id);

  if (analyses.length === 0 && deadlines.length === 0) return;

  const avgRisk = analyses.length > 0
    ? (analyses.reduce((s, a) => s + (a.risk_score || 0), 0) / analyses.length).toFixed(1) : "N/A";

  const subject = `Weekly Digest: ${analyses.length} analyses, ${deadlines.length} upcoming deadlines`;
  const html = `${logoHeader()}
    <div style="padding:30px;font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto">
      <h2>Your Weekly Digest</h2>
      <div style="display:flex;gap:20px;margin:20px 0">
        <div style="flex:1;background:#f0fdf4;border-radius:12px;padding:15px;text-align:center">
          <div style="font-size:2em;font-weight:700;color:#16a34a">${analyses.length}</div>
          <div style="font-size:0.9em;color:#666">Analyses This Week</div>
        </div>
        <div style="flex:1;background:#fffbeb;border-radius:12px;padding:15px;text-align:center">
          <div style="font-size:2em;font-weight:700;color:#f59e0b">${avgRisk}</div>
          <div style="font-size:0.9em;color:#666">Avg Risk Score</div>
        </div>
        <div style="flex:1;background:#fef2f2;border-radius:12px;padding:15px;text-align:center">
          <div style="font-size:2em;font-weight:700;color:#dc2626">${deadlines.length}</div>
          <div style="font-size:0.9em;color:#666">Upcoming Deadlines</div>
        </div>
      </div>
      ${analyses.length > 0 ? `<h3>Recent Analyses</h3><ul>${analyses.slice(0, 5).map(a => `<li><strong>${a.filename}</strong> — Risk: ${a.risk_score}/10 (${a.risk_label})</li>`).join("")}</ul>` : ""}
      ${deadlines.length > 0 ? `<h3 style="color:#f59e0b">Upcoming Deadlines</h3><ul>${deadlines.map(d => { const days = Math.ceil((new Date(d.deadline_date) - new Date()) / 86400000); return `<li><strong>${d.title}</strong> — ${days <= 0 ? "OVERDUE" : days + " days left"}</li>`; }).join("")}</ul>` : ""}
      <div style="text-align:center;margin:30px 0">
        <a href="${APP_URL}" style="background:#4f46e5;color:#fff;padding:12px 30px;border-radius:8px;text-decoration:none;font-weight:600">Open Dashboard</a>
      </div>
      <p style="color:#999;font-size:12px;text-align:center">Manage email preferences in <a href="${APP_URL}">Settings</a></p>
    </div>`;
  const sent = await send(user.email, subject, html);
  if (sent) logEmail(user.id, "weekly_digest", subject);
}

// Check all deadlines and send alerts
function checkDeadlineAlerts() {
  const users = db.prepare("SELECT * FROM users WHERE email_deadline_alerts = 1").all();
  for (const user of users) {
    const deadlines = db.prepare(
      "SELECT * FROM contract_deadlines WHERE user_id = ? AND status = 'active'"
    ).all(user.id);

    for (const dl of deadlines) {
      const daysLeft = Math.ceil((new Date(dl.deadline_date) - new Date()) / 86400000);
      if (daysLeft <= dl.alert_days) {
        // Check if we already sent an alert today
        const recentAlert = db.prepare(
          "SELECT * FROM email_log WHERE user_id = ? AND email_type = 'deadline_alert' AND sent_at >= date('now') AND subject LIKE ?"
        ).get(user.id, `%${dl.title}%`);
        if (!recentAlert) sendDeadlineAlert(user, dl);
      }
    }
  }
}

module.exports = { send, sendWelcome, sendAnalysisComplete, sendDeadlineAlert, sendWeeklyDigest, checkDeadlineAlerts, transporter };
