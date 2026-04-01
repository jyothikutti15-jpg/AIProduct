// ─── State ───────────────────────────────────────────────────────────────────
let currentAnalysis = null;
let chatHistory = [];
let compareFileA = null;
let compareFileB = null;
let currentUser = null;
let authToken = localStorage.getItem("auth_token") || null;

// ─── DOM Refs ────────────────────────────────────────────────────────────────
const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const uploadContent = document.getElementById("uploadContent");
const uploadProgress = document.getElementById("uploadProgress");
const errorMessage = document.getElementById("errorMessage");
const resultsSection = document.getElementById("resultsSection");

// ─── Page Navigation ─────────────────────────────────────────────────────────
function showPage(page) {
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  const target = document.getElementById("page-" + page);
  if (target) target.classList.add("active");

  if (page === "dashboard") renderDashboard();
  if (page === "history") renderHistory();

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ─── Mobile Menu ─────────────────────────────────────────────────────────────
function toggleMobileMenu() {
  document.getElementById("mobileMenu").classList.toggle("open");
}

// ─── Dark Mode ───────────────────────────────────────────────────────────────
function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  html.setAttribute("data-theme", next);
  localStorage.setItem("theme", next);
  document.getElementById("themeIcon").textContent = next === "dark" ? "\u2600" : "\ud83c\udf19";
}

(function initTheme() {
  const saved = localStorage.getItem("theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = saved || (prefersDark ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);
  document.getElementById("themeIcon").textContent = theme === "dark" ? "\u2600" : "\ud83c\udf19";
})();

// ─── LocalStorage History ────────────────────────────────────────────────────
function getHistory() {
  try { return JSON.parse(localStorage.getItem("contractshield_history") || "[]"); }
  catch { return []; }
}

function saveToHistory(analysis) {
  const history = getHistory();
  // Avoid duplicates
  const exists = history.find((h) => h.id === analysis.id);
  if (!exists) {
    history.unshift(analysis);
    if (history.length > 100) history.pop();
    localStorage.setItem("contractshield_history", JSON.stringify(history));
  }
}

function deleteFromHistory(id) {
  const history = getHistory().filter((h) => h.id !== id);
  localStorage.setItem("contractshield_history", JSON.stringify(history));
  renderHistory();
  renderDashboard();
}

function clearHistory() {
  if (confirm("Delete all analysis history? This cannot be undone.")) {
    localStorage.removeItem("contractshield_history");
    renderHistory();
    renderDashboard();
  }
}

function loadFromHistory(id) {
  const item = getHistory().find((h) => h.id === id);
  if (item) {
    currentAnalysis = item;
    chatHistory = [];
    showPage("home");
    renderResults(item);
  }
}

// ─── File Upload ─────────────────────────────────────────────────────────────
dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("dragover"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", (e) => { e.preventDefault(); dropZone.classList.remove("dragover"); if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]); });
fileInput.addEventListener("change", () => { if (fileInput.files.length) handleFile(fileInput.files[0]); });

async function handleFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (!["pdf", "txt"].includes(ext)) { showError("Please upload a PDF or TXT file."); return; }
  if (file.size > 20 * 1024 * 1024) { showError("File is too large. Maximum size is 20MB."); return; }

  showProgress();
  const formData = new FormData();
  formData.append("document", file);
  const lang = document.getElementById("analysisLang").value;
  if (lang !== "auto") formData.append("language", lang);

  try {
    const response = await fetch("/api/analyze", { method: "POST", body: formData });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Analysis failed");
    currentAnalysis = data;
    chatHistory = [];
    saveToHistory(data);
    renderResults(data);
  } catch (error) {
    showError(error.message || "Failed to analyze document. Please try again.");
    resetUploadUI();
  }
}

function showDemo() {
  showPage("home");
  showProgress();
  fetch("/api/demo", { method: "POST" })
    .then((r) => r.json())
    .then((data) => { currentAnalysis = data; chatHistory = []; saveToHistory(data); renderResults(data); })
    .catch(() => { showError("Demo failed to load."); resetUploadUI(); });
}

function showProgress() {
  errorMessage.style.display = "none";
  uploadContent.style.display = "none";
  uploadProgress.style.display = "block";
  const fill = document.getElementById("progressFill");
  fill.style.animation = "none";
  void fill.offsetHeight;
  fill.style.animation = "progress 20s ease-out forwards";
}

function showError(msg) { errorMessage.textContent = msg; errorMessage.style.display = "block"; }

function resetUploadUI() {
  uploadContent.style.display = "block";
  uploadProgress.style.display = "none";
  fileInput.value = "";
}

function resetUpload() {
  resultsSection.style.display = "none";
  document.getElementById("upload-section").style.display = "block";
  resetUploadUI();
}

// ─── Render Analysis Results ─────────────────────────────────────────────────
function getRiskColor(score) {
  if (score <= 3) return "var(--success)";
  if (score <= 5) return "var(--warning)";
  if (score <= 7) return "#dc2626";
  return "#991b1b";
}

function getRiskBg(score) {
  if (score <= 3) return "var(--success-light)";
  if (score <= 5) return "var(--warning-light)";
  return "var(--danger-light)";
}

function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function renderResults(data) {
  uploadProgress.style.display = "none";
  uploadContent.style.display = "block";
  document.getElementById("upload-section").style.display = "none";
  resultsSection.style.display = "block";
  resultsSection.scrollIntoView({ behavior: "smooth" });

  document.getElementById("resultFilename").textContent = data.filename;

  // Language badge
  const langBadge = document.getElementById("langBadge");
  if (data.language_detected) { langBadge.textContent = data.language_detected; langBadge.style.display = "inline-block"; }
  else { langBadge.style.display = "none"; }

  // Risk score
  const score = data.overall_risk_score || 0;
  const color = getRiskColor(score);
  const circle = document.getElementById("riskScoreCircle");
  circle.style.borderColor = color;
  circle.style.background = getRiskBg(score);
  document.getElementById("riskNumber").textContent = score;
  document.getElementById("riskNumber").style.color = color;
  const riskLabel = document.getElementById("riskLabel");
  riskLabel.textContent = data.overall_risk_label || "Risk Assessment";
  riskLabel.style.color = color;
  document.getElementById("summaryText").textContent = data.summary || "";
  document.getElementById("docType").textContent = data.document_type || "";
  document.getElementById("partiesInfo").textContent = data.parties ? data.parties.join(" & ") : "";
  document.getElementById("analyzedAt").textContent = data.analyzed_at ? new Date(data.analyzed_at).toLocaleString() : "";

  // Red flags
  renderList("redFlagsCard", "redFlagsList", data.red_flags, (flag) => `<div class="red-flag-item">${escapeHtml(flag)}</div>`);

  // Financial terms
  renderList("financialCard", "financialList", data.financial_terms, (ft) =>
    `<div class="financial-item"><span class="financial-label">${escapeHtml(ft.item)}</span><span><span class="financial-value">${escapeHtml(ft.amount)}</span> <span class="financial-freq">${escapeHtml(ft.frequency)}</span></span></div>`);

  // Key dates
  renderList("keyDatesCard", "keyDatesList", data.key_dates, (d) =>
    `<div class="key-date-item"><span class="key-date-event">${escapeHtml(d.event)}</span><span class="key-date-value">${escapeHtml(d.date)}</span></div>`);

  // Clauses
  const clausesList = document.getElementById("clausesList");
  clausesList.innerHTML = "";
  (data.clauses || []).forEach((clause) => {
    clausesList.innerHTML += `
      <div class="clause-item">
        <div class="clause-header">
          <span class="clause-title">${escapeHtml(clause.title)}</span>
          <span class="risk-badge risk-${clause.risk_level}">${escapeHtml(clause.risk_level)}</span>
        </div>
        <div class="clause-summary">${escapeHtml(clause.summary)}</div>
        ${clause.risk_reason ? `<div class="clause-detail"><strong>Risk:</strong> ${escapeHtml(clause.risk_reason)}</div>` : ""}
        ${clause.recommendation ? `<div class="clause-detail"><strong>Advice:</strong> ${escapeHtml(clause.recommendation)}</div>` : ""}
        ${clause.legal_reference ? `<div class="clause-legal-ref">Ref: ${escapeHtml(clause.legal_reference)}</div>` : ""}
      </div>`;
  });

  // Missing clauses
  renderList("missingClausesCard", "missingClausesList", data.missing_clauses, (mc) =>
    `<div class="missing-item"><div class="importance-dot importance-${mc.importance}"></div><div><h4>${escapeHtml(mc.clause)}</h4><p>${escapeHtml(mc.reason)}</p></div></div>`);

  // Compliance notes
  renderList("complianceCard", "complianceList", data.compliance_notes, (note) =>
    `<div class="compliance-item">${escapeHtml(note)}</div>`);

  // Action items
  renderList("actionItemsCard", "actionItemsList", data.action_items, (item) =>
    `<div class="action-item">${escapeHtml(item)}</div>`);

  // Negotiation points
  renderList("negotiationCard", "negotiationList", data.negotiation_points, (point) =>
    `<div class="negotiation-item">${escapeHtml(point)}</div>`);

  // Reset chat
  document.getElementById("chatMessages").innerHTML = `<div class="chat-msg assistant"><div class="chat-bubble">I've analyzed your contract. Ask me anything about the clauses, risks, or what to negotiate!</div></div>`;
}

function renderList(cardId, listId, items, renderFn) {
  const card = document.getElementById(cardId);
  const list = document.getElementById(listId);
  list.innerHTML = "";
  if (items && items.length > 0) {
    card.style.display = "block";
    items.forEach((item) => { list.innerHTML += renderFn(item); });
  } else {
    card.style.display = "none";
  }
}

// ─── AI Chat ─────────────────────────────────────────────────────────────────
async function sendChat() {
  const input = document.getElementById("chatInput");
  const question = input.value.trim();
  if (!question || !currentAnalysis) return;

  input.value = "";
  const chatBox = document.getElementById("chatMessages");

  // Add user message
  chatBox.innerHTML += `<div class="chat-msg user"><div class="chat-bubble">${escapeHtml(question)}</div></div>`;

  // Add typing indicator
  chatBox.innerHTML += `<div class="chat-msg assistant" id="chatTyping"><div class="chat-bubble"><div class="chat-typing"><span></span><span></span><span></span></div></div></div>`;
  chatBox.scrollTop = chatBox.scrollHeight;

  chatHistory.push({ role: "user", content: question });

  try {
    const isDemo = currentAnalysis.id && currentAnalysis.id.startsWith("demo_");
    const endpoint = isDemo ? "/api/demo/chat" : "/api/chat";
    const body = isDemo
      ? { question }
      : { question, analysis: currentAnalysis, history: chatHistory };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    const typingEl = document.getElementById("chatTyping");
    if (typingEl) typingEl.remove();

    chatHistory.push({ role: "assistant", content: data.response });
    chatBox.innerHTML += `<div class="chat-msg assistant"><div class="chat-bubble">${escapeHtml(data.response)}</div></div>`;
  } catch (error) {
    const typingEl = document.getElementById("chatTyping");
    if (typingEl) typingEl.remove();
    chatBox.innerHTML += `<div class="chat-msg assistant"><div class="chat-bubble">Sorry, I couldn't get a response. ${escapeHtml(error.message)}</div></div>`;
  }

  chatBox.scrollTop = chatBox.scrollHeight;
}

// ─── Contract Comparison ─────────────────────────────────────────────────────
const compareDropA = document.getElementById("compareDropA");
const compareDropB = document.getElementById("compareDropB");
const compareInputA = document.getElementById("compareInputA");
const compareInputB = document.getElementById("compareInputB");

compareDropA.addEventListener("click", () => compareInputA.click());
compareDropB.addEventListener("click", () => compareInputB.click());

[compareDropA, compareDropB].forEach((zone) => {
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.style.borderColor = "var(--primary)"; });
  zone.addEventListener("dragleave", () => { zone.style.borderColor = ""; });
});

compareDropA.addEventListener("drop", (e) => { e.preventDefault(); compareDropA.style.borderColor = ""; if (e.dataTransfer.files.length) setCompareFile("A", e.dataTransfer.files[0]); });
compareDropB.addEventListener("drop", (e) => { e.preventDefault(); compareDropB.style.borderColor = ""; if (e.dataTransfer.files.length) setCompareFile("B", e.dataTransfer.files[0]); });

compareInputA.addEventListener("change", () => { if (compareInputA.files.length) setCompareFile("A", compareInputA.files[0]); });
compareInputB.addEventListener("change", () => { if (compareInputB.files.length) setCompareFile("B", compareInputB.files[0]); });

function setCompareFile(side, file) {
  if (side === "A") {
    compareFileA = file;
    document.getElementById("compareFileA").textContent = file.name;
    compareDropA.classList.add("has-file");
  } else {
    compareFileB = file;
    document.getElementById("compareFileB").textContent = file.name;
    compareDropB.classList.add("has-file");
  }
  document.getElementById("compareBtn").disabled = !(compareFileA && compareFileB);
}

async function compareContracts() {
  if (!compareFileA || !compareFileB) return;

  const progress = document.getElementById("compareProgress");
  const errorEl = document.getElementById("compareError");
  const results = document.getElementById("compareResults");
  errorEl.style.display = "none";
  results.style.display = "none";
  progress.style.display = "block";

  const formData = new FormData();
  formData.append("documentA", compareFileA);
  formData.append("documentB", compareFileB);

  try {
    const response = await fetch("/api/compare", { method: "POST", body: formData });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    renderComparison(data);
  } catch (error) {
    errorEl.textContent = error.message;
    errorEl.style.display = "block";
  } finally {
    progress.style.display = "none";
  }
}

function renderComparison(data) {
  const results = document.getElementById("compareResults");
  results.style.display = "block";

  document.getElementById("compareSummary").textContent = data.summary;
  document.getElementById("compareNameA").textContent = data.filename_a || "Contract A";
  document.getElementById("compareNameB").textContent = data.filename_b || "Contract B";

  if (data.risk_comparison) {
    const rc = data.risk_comparison;
    const circleA = document.getElementById("compareScoreA");
    const circleB = document.getElementById("compareScoreB");
    circleA.style.borderColor = getRiskColor(rc.contract_a_score);
    circleA.style.background = getRiskBg(rc.contract_a_score);
    circleB.style.borderColor = getRiskColor(rc.contract_b_score);
    circleB.style.background = getRiskBg(rc.contract_b_score);
    document.getElementById("compareRiskNumA").textContent = rc.contract_a_score;
    document.getElementById("compareRiskNumA").style.color = getRiskColor(rc.contract_a_score);
    document.getElementById("compareRiskNumB").textContent = rc.contract_b_score;
    document.getElementById("compareRiskNumB").style.color = getRiskColor(rc.contract_b_score);
    document.getElementById("compareRiskLabelA").textContent = rc.contract_a_label;
    document.getElementById("compareRiskLabelB").textContent = rc.contract_b_label;
  }

  // Differences
  const diffsList = document.getElementById("compareDiffsList");
  diffsList.innerHTML = "";
  (data.differences || []).forEach((diff) => {
    diffsList.innerHTML += `
      <div class="diff-item">
        <div class="diff-topic">${escapeHtml(diff.topic)}</div>
        <div class="diff-cols">
          <div class="diff-col ${diff.which_is_better === 'a' ? 'diff-better' : ''}">
            <div class="diff-col-label">Contract A</div>
            ${escapeHtml(diff.contract_a)}
          </div>
          <div class="diff-col ${diff.which_is_better === 'b' ? 'diff-better' : ''}">
            <div class="diff-col-label">Contract B</div>
            ${escapeHtml(diff.contract_b)}
          </div>
        </div>
        ${diff.recommendation ? `<div class="diff-recommendation">${escapeHtml(diff.recommendation)}</div>` : ""}
      </div>`;
  });

  // Similarities
  const simList = document.getElementById("compareSimilaritiesList");
  simList.innerHTML = "";
  (data.similarities || []).forEach((sim) => {
    simList.innerHTML += `<div class="similarity-item"><span class="similarity-topic">${escapeHtml(sim.topic)}:</span> <span class="similarity-detail">${escapeHtml(sim.detail)}</span></div>`;
  });

  document.getElementById("compareRecommendation").textContent = data.recommendation || "";
  results.scrollIntoView({ behavior: "smooth" });
}

// ─── Contract Template Generator ─────────────────────────────────────────────
function updateTemplateForm() {
  // Future: customize fields per template type
}

async function generateContract() {
  const templateType = document.getElementById("templateType").value;
  if (!templateType) { document.getElementById("generateError").textContent = "Please select a contract type."; document.getElementById("generateError").style.display = "block"; return; }

  const progress = document.getElementById("generateProgress");
  const errorEl = document.getElementById("generateError");
  const results = document.getElementById("generateResults");
  errorEl.style.display = "none";
  results.style.display = "none";
  progress.style.display = "block";

  const details = {
    party_a: document.getElementById("genPartyA").value || "Party A",
    party_b: document.getElementById("genPartyB").value || "Party B",
    terms: document.getElementById("genTerms").value || "",
    jurisdiction: document.getElementById("genJurisdiction").value || "State of Delaware, USA",
  };

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template_type: templateType, details }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    renderGeneratedContract(data);
  } catch (error) {
    errorEl.textContent = error.message;
    errorEl.style.display = "block";
  } finally {
    progress.style.display = "none";
  }
}

function renderGeneratedContract(data) {
  const results = document.getElementById("generateResults");
  results.style.display = "block";
  document.getElementById("generatedTitle").textContent = data.title || data.template_type;

  // Render sections or raw content
  const contentEl = document.getElementById("generatedContent");
  if (data.sections && data.sections.length > 0) {
    contentEl.innerHTML = data.sections.map((s) =>
      `<h4 style="margin-top:1.5rem;margin-bottom:0.5rem;color:var(--primary)">${escapeHtml(s.title)}</h4><p>${escapeHtml(s.content)}</p>`
    ).join("");
  } else {
    contentEl.textContent = data.content || "";
  }

  // Notes
  const notesCard = document.getElementById("genNotesCard");
  const notesEl = document.getElementById("generatedNotes");
  notesEl.innerHTML = "";
  if (data.notes && data.notes.length > 0) {
    notesCard.style.display = "block";
    data.notes.forEach((n) => { notesEl.innerHTML += `<div class="action-item">${escapeHtml(n)}</div>`; });
    if (data.disclaimer) notesEl.innerHTML += `<p style="margin-top:1rem;font-style:italic;color:var(--text-secondary)">${escapeHtml(data.disclaimer)}</p>`;
  } else {
    notesCard.style.display = "none";
  }

  results.scrollIntoView({ behavior: "smooth" });
}

function copyContract() {
  const content = document.getElementById("generatedContent").innerText;
  navigator.clipboard.writeText(content).then(() => alert("Contract copied to clipboard!"));
}

function exportGeneratedPDF() {
  const title = document.getElementById("generatedTitle").textContent;
  const content = document.getElementById("generatedContent").innerHTML;
  const html = `<html><head><title>${escapeHtml(title)}</title>
    <style>body{font-family:Georgia,serif;max-width:800px;margin:0 auto;padding:40px;line-height:1.8;color:#333}h1{text-align:center;border-bottom:2px solid #333;padding-bottom:10px}h4{color:#4f46e5;margin-top:2rem}.footer{margin-top:3rem;text-align:center;font-size:0.8em;color:#999;border-top:1px solid #ddd;padding-top:1rem}</style>
    </head><body><h1>${escapeHtml(title)}</h1>${content}
    <div class="footer">Generated by ContractShield AI | ${new Date().toLocaleDateString()}<br/>This template should be reviewed by a qualified attorney.</div></body></html>`;
  const w = window.open("", "_blank");
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 500);
}

// ─── Dashboard ───────────────────────────────────────────────────────────────
function renderDashboard() {
  const history = getHistory();

  // Stats
  document.getElementById("statTotal").textContent = history.length;

  const avgRisk = history.length > 0
    ? (history.reduce((sum, h) => sum + (h.overall_risk_score || 0), 0) / history.length).toFixed(1)
    : "0";
  document.getElementById("statAvgRisk").textContent = avgRisk;

  const highRisk = history.filter((h) => (h.overall_risk_score || 0) >= 7).length;
  document.getElementById("statHighRisk").textContent = highRisk;

  const totalFlags = history.reduce((sum, h) => sum + (h.red_flags ? h.red_flags.length : 0), 0);
  document.getElementById("statRedFlags").textContent = totalFlags;

  // Risk distribution chart
  const riskBuckets = { "Low (1-3)": 0, "Medium (4-5)": 0, "High (6-7)": 0, "Critical (8-10)": 0 };
  const riskColors = { "Low (1-3)": "#16a34a", "Medium (4-5)": "#f59e0b", "High (6-7)": "#dc2626", "Critical (8-10)": "#991b1b" };
  history.forEach((h) => {
    const s = h.overall_risk_score || 0;
    if (s <= 3) riskBuckets["Low (1-3)"]++;
    else if (s <= 5) riskBuckets["Medium (4-5)"]++;
    else if (s <= 7) riskBuckets["High (6-7)"]++;
    else riskBuckets["Critical (8-10)"]++;
  });

  const maxBucket = Math.max(...Object.values(riskBuckets), 1);
  document.getElementById("riskChart").innerHTML = `<div class="bar-chart">${
    Object.entries(riskBuckets).map(([label, count]) =>
      `<div class="bar-row"><span class="bar-label">${label}</span><div class="bar-track"><div class="bar-fill" style="width:${(count/maxBucket)*100}%;background:${riskColors[label]}">${count}</div></div></div>`
    ).join("")
  }</div>`;

  // Common red flags
  const flagCounts = {};
  history.forEach((h) => (h.red_flags || []).forEach((f) => { flagCounts[f] = (flagCounts[f] || 0) + 1; }));
  const topFlags = Object.entries(flagCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const flagsEl = document.getElementById("commonRedFlags");
  if (topFlags.length > 0) {
    flagsEl.innerHTML = topFlags.map(([flag, count]) =>
      `<div class="red-flag-item" style="justify-content:space-between">${escapeHtml(flag)} <span style="color:var(--text-secondary);font-size:0.8rem">(${count}x)</span></div>`
    ).join("");
  } else {
    flagsEl.innerHTML = '<p class="empty-state">Analyze contracts to see common red flags</p>';
  }

  // Document types
  const typeCounts = {};
  history.forEach((h) => { if (h.document_type) typeCounts[h.document_type] = (typeCounts[h.document_type] || 0) + 1; });
  const docTypeEl = document.getElementById("docTypeChart");
  if (Object.keys(typeCounts).length > 0) {
    docTypeEl.innerHTML = Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `<span class="type-pill">${escapeHtml(type)} <span class="type-pill-count">${count}</span></span>`)
      .join("");
  } else {
    docTypeEl.innerHTML = '<p class="empty-state">No document types yet</p>';
  }

  // Recent analyses
  const recentEl = document.getElementById("recentAnalyses");
  const recent = history.slice(0, 5);
  if (recent.length > 0) {
    recentEl.innerHTML = recent.map((h) =>
      `<div class="recent-item" onclick="loadFromHistory('${h.id}')">
        <span class="recent-name">${escapeHtml(h.filename)}</span>
        <span class="recent-meta">
          <span class="risk-badge risk-${getRiskLevel(h.overall_risk_score)}">${h.overall_risk_score}/10</span>
          <span>${h.analyzed_at ? new Date(h.analyzed_at).toLocaleDateString() : ""}</span>
        </span>
      </div>`
    ).join("");
  } else {
    recentEl.innerHTML = '<p class="empty-state">No analyses yet</p>';
  }
}

function getRiskLevel(score) {
  if (score <= 3) return "low";
  if (score <= 5) return "medium";
  if (score <= 7) return "high";
  return "critical";
}

// ─── History Page ────────────────────────────────────────────────────────────
function renderHistory() {
  const search = (document.getElementById("historySearch")?.value || "").toLowerCase();
  const filter = document.getElementById("historyFilter")?.value || "all";
  let history = getHistory();

  if (search) {
    history = history.filter((h) =>
      (h.filename || "").toLowerCase().includes(search) ||
      (h.document_type || "").toLowerCase().includes(search)
    );
  }

  if (filter !== "all") {
    history = history.filter((h) => {
      const s = h.overall_risk_score || 0;
      if (filter === "low") return s <= 3;
      if (filter === "medium") return s >= 4 && s <= 5;
      if (filter === "high") return s >= 6 && s <= 7;
      if (filter === "critical") return s >= 8;
      return true;
    });
  }

  const listEl = document.getElementById("historyList");
  if (history.length === 0) {
    listEl.innerHTML = '<p class="empty-state">No analyses found.</p>';
    return;
  }

  listEl.innerHTML = history.map((h) => {
    const color = getRiskColor(h.overall_risk_score || 0);
    return `<div class="history-card" onclick="loadFromHistory('${h.id}')">
      <div class="history-info">
        <h4>${escapeHtml(h.filename)}</h4>
        <p>${escapeHtml(h.document_type || "Unknown")} &middot; ${h.analyzed_at ? new Date(h.analyzed_at).toLocaleDateString() : ""}
        ${h.parties ? " &middot; " + h.parties.map(escapeHtml).join(", ") : ""}</p>
      </div>
      <div class="history-right">
        <div class="history-score" style="border-color:${color};color:${color}">${h.overall_risk_score || "?"}</div>
        <button class="history-delete" onclick="event.stopPropagation();deleteFromHistory('${h.id}')" title="Delete">&times;</button>
      </div>
    </div>`;
  }).join("");
}

// ─── PDF Export ──────────────────────────────────────────────────────────────
function exportPDF() {
  if (!currentAnalysis) return;
  const d = currentAnalysis;

  const html = `<html><head><title>Contract Analysis - ${escapeHtml(d.filename)}</title>
    <style>
      body{font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:40px;color:#333;line-height:1.6}
      h1{color:#4f46e5;border-bottom:3px solid #4f46e5;padding-bottom:10px}
      h2{color:#374151;margin-top:30px;border-bottom:1px solid #e5e7eb;padding-bottom:8px}
      .risk-score{font-size:48px;font-weight:800;text-align:center;padding:20px;border-radius:12px;margin:20px 0}
      .meta{color:#6b7280;font-size:0.9em;margin-bottom:20px}
      .clause{padding:12px 0;border-bottom:1px solid #f3f4f6}
      .clause-title{font-weight:600}
      .risk-tag{display:inline-block;padding:2px 8px;border-radius:12px;font-size:0.8em;font-weight:600}
      .risk-low{background:#f0fdf4;color:#16a34a}.risk-medium{background:#fffbeb;color:#f59e0b}
      .risk-high{background:#fef2f2;color:#dc2626}.risk-critical{background:#dc2626;color:#fff}
      .red-flag{color:#dc2626;padding:4px 0}.missing{padding:8px 0}
      .footer{margin-top:40px;text-align:center;color:#9ca3af;font-size:0.8em;border-top:1px solid #e5e7eb;padding-top:20px}
      ul{padding-left:20px}li{margin:4px 0}
      .financial{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f3f4f6}
    </style></head><body>
    <h1>ContractShield AI - Analysis Report</h1>
    <div class="meta">
      <strong>File:</strong> ${escapeHtml(d.filename)} | <strong>Type:</strong> ${escapeHtml(d.document_type||"N/A")} | <strong>Date:</strong> ${d.analyzed_at?new Date(d.analyzed_at).toLocaleDateString():"N/A"}
      ${d.parties?" | <strong>Parties:</strong> "+d.parties.map(escapeHtml).join(", "):""}
      ${d.language_detected?" | <strong>Language:</strong> "+escapeHtml(d.language_detected):""}
    </div>
    <div class="risk-score" style="background:${getRiskBg(d.overall_risk_score)};color:${getRiskColor(d.overall_risk_score)}">
      Risk Score: ${d.overall_risk_score}/10 — ${escapeHtml(d.overall_risk_label||"")}
    </div>
    <h2>Summary</h2><p>${escapeHtml(d.summary||"")}</p>
    ${d.red_flags&&d.red_flags.length?`<h2>Red Flags</h2>${d.red_flags.map(f=>`<div class="red-flag">\u26d4 ${escapeHtml(f)}</div>`).join("")}`:""}
    ${d.financial_terms&&d.financial_terms.length?`<h2>Financial Terms</h2>${d.financial_terms.map(ft=>`<div class="financial"><span>${escapeHtml(ft.item)}</span><span><strong>${escapeHtml(ft.amount)}</strong> (${escapeHtml(ft.frequency)})</span></div>`).join("")}`:""}
    ${d.key_dates&&d.key_dates.length?`<h2>Key Dates</h2><ul>${d.key_dates.map(kd=>`<li><strong>${escapeHtml(kd.event)}:</strong> ${escapeHtml(kd.date)}</li>`).join("")}</ul>`:""}
    <h2>Clause Analysis</h2>${(d.clauses||[]).map(c=>`<div class="clause"><span class="clause-title">${escapeHtml(c.title)}</span> <span class="risk-tag risk-${c.risk_level}">${escapeHtml(c.risk_level)}</span><p>${escapeHtml(c.summary)}</p>${c.risk_reason?`<p><strong>Risk:</strong> ${escapeHtml(c.risk_reason)}</p>`:""}${c.recommendation?`<p><strong>Recommendation:</strong> ${escapeHtml(c.recommendation)}</p>`:""}${c.legal_reference?`<p><em>Ref: ${escapeHtml(c.legal_reference)}</em></p>`:""}</div>`).join("")}
    ${d.missing_clauses&&d.missing_clauses.length?`<h2>Missing Clauses</h2>${d.missing_clauses.map(mc=>`<div class="missing"><strong>${escapeHtml(mc.clause)}</strong> (${escapeHtml(mc.importance)} importance)<br/>${escapeHtml(mc.reason)}</div>`).join("")}`:""}
    ${d.compliance_notes&&d.compliance_notes.length?`<h2>Compliance Notes</h2><ul>${d.compliance_notes.map(n=>`<li>${escapeHtml(n)}</li>`).join("")}</ul>`:""}
    ${d.action_items&&d.action_items.length?`<h2>Recommended Actions</h2><ul>${d.action_items.map(a=>`<li>${escapeHtml(a)}</li>`).join("")}</ul>`:""}
    ${d.negotiation_points&&d.negotiation_points.length?`<h2>Negotiation Points</h2><ul>${d.negotiation_points.map(n=>`<li>${escapeHtml(n)}</li>`).join("")}</ul>`:""}
    <div class="footer">Generated by ContractShield AI | ${new Date().toLocaleDateString()}<br/>This analysis is for informational purposes only and does not constitute legal advice.</div>
    </body></html>`;

  const w = window.open("", "_blank");
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 500);
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════

function authHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (authToken) headers["Authorization"] = "Bearer " + authToken;
  return headers;
}

function showModal(id) {
  closeModals();
  document.getElementById(id).style.display = "flex";
}

function closeModals() {
  document.querySelectorAll(".modal-overlay").forEach((m) => (m.style.display = "none"));
  document.querySelectorAll(".modal-error").forEach((e) => (e.style.display = "none"));
}

async function doSignup() {
  const name = document.getElementById("signupName").value.trim();
  const email = document.getElementById("signupEmail").value.trim();
  const company = document.getElementById("signupCompany").value.trim();
  const password = document.getElementById("signupPassword").value;
  const errorEl = document.getElementById("signupError");
  errorEl.style.display = "none";

  if (!name || !email || !password) { errorEl.textContent = "Please fill in all required fields."; errorEl.style.display = "block"; return; }
  if (password.length < 8) { errorEl.textContent = "Password must be at least 8 characters."; errorEl.style.display = "block"; return; }

  const btn = document.getElementById("signupBtn");
  btn.disabled = true;
  btn.textContent = "Creating account...";

  try {
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, company, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    authToken = data.token;
    currentUser = data.user;
    localStorage.setItem("auth_token", authToken);
    closeModals();
    updateAuthUI();
  } catch (e) {
    errorEl.textContent = e.message;
    errorEl.style.display = "block";
  } finally {
    btn.disabled = false;
    btn.textContent = "Create Account";
  }
}

async function doLogin() {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errorEl = document.getElementById("loginError");
  errorEl.style.display = "none";

  if (!email || !password) { errorEl.textContent = "Please enter email and password."; errorEl.style.display = "block"; return; }

  const btn = document.getElementById("loginBtn");
  btn.disabled = true;
  btn.textContent = "Logging in...";

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    authToken = data.token;
    currentUser = data.user;
    localStorage.setItem("auth_token", authToken);
    closeModals();
    updateAuthUI();
  } catch (e) {
    errorEl.textContent = e.message;
    errorEl.style.display = "block";
  } finally {
    btn.disabled = false;
    btn.textContent = "Log In";
  }
}

function logout() {
  authToken = null;
  currentUser = null;
  localStorage.removeItem("auth_token");
  updateAuthUI();
  showPage("home");
}

function updateAuthUI() {
  const authBtns = document.getElementById("authButtons");
  const userMenu = document.getElementById("userMenu");
  const userMenuBtn = document.getElementById("userMenuBtn");

  if (currentUser) {
    authBtns.style.display = "none";
    userMenu.style.display = "flex";
    userMenuBtn.textContent = currentUser.name.split(" ")[0];
  } else {
    authBtns.style.display = "flex";
    userMenu.style.display = "none";
  }
}

async function loadUser() {
  if (!authToken) return;
  try {
    const res = await fetch("/api/auth/me", { headers: authHeaders() });
    if (!res.ok) { logout(); return; }
    const data = await res.json();
    currentUser = data.user;
    updateAuthUI();
  } catch { logout(); }
}

async function saveProfile() {
  const name = document.getElementById("settingsName").value.trim();
  const company = document.getElementById("settingsCompany").value.trim();
  if (!name) return;
  await fetch("/api/auth/profile", {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ name, company }),
  });
  currentUser.name = name;
  currentUser.company = company;
  updateAuthUI();
  alert("Profile saved!");
}

// ═══════════════════════════════════════════════════════════════════════════════
// STRIPE PAYMENTS
// ═══════════════════════════════════════════════════════════════════════════════

async function startCheckout(plan) {
  if (!currentUser) {
    showModal("signupModal");
    return;
  }

  try {
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ plan }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    if (data.url) window.location.href = data.url;
  } catch (e) {
    alert("Payment error: " + e.message);
  }
}

async function openBillingPortal() {
  try {
    const res = await fetch("/api/billing/portal", {
      method: "POST",
      headers: authHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    if (data.url) window.location.href = data.url;
  } catch (e) {
    alert("Billing error: " + e.message);
  }
}

function loadSettings() {
  if (!currentUser) return;
  document.getElementById("settingsName").value = currentUser.name || "";
  document.getElementById("settingsCompany").value = currentUser.company || "";
  document.getElementById("settingsPlan").textContent = (currentUser.plan || "free").charAt(0).toUpperCase() + (currentUser.plan || "free").slice(1);

  const limits = currentUser.limits || { analyses: 3 };
  const used = currentUser.analyses_used || 0;
  const limit = limits.analyses === -1 ? "Unlimited" : limits.analyses;
  document.getElementById("settingsUsage").textContent = used;
  document.getElementById("settingsLimit").textContent = limit;

  const pct = limits.analyses === -1 ? 10 : Math.min(100, (used / limits.analyses) * 100);
  document.getElementById("usageBar").style.width = pct + "%";

  document.getElementById("upgradeBtn").style.display = currentUser.plan === "enterprise" ? "none" : "inline-flex";
  document.getElementById("manageBillingBtn").style.display = currentUser.stripe_subscription_id ? "inline-flex" : "none";
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTOR LANDING PAGES
// ═══════════════════════════════════════════════════════════════════════════════

const SECTORS = {
  "real-estate": {
    badge: "For Real Estate Professionals",
    title: "Never Miss a Clause in a<br/><span class='gradient-text'>Property Contract Again</span>",
    subtitle: "Analyze leases, purchase agreements, and HOA contracts in 30 seconds. Spot unfair terms before your clients sign.",
    benefitsTitle: "Why Real Estate Agents Love ContractShield",
    features: [
      { icon: "&#x1f3e0;", title: "Lease Analysis", desc: "Instant breakdown of rental agreements, sublease terms, and tenant rights." },
      { icon: "&#x1f4b0;", title: "Purchase Agreement Review", desc: "Catch hidden fees, contingency gaps, and closing cost traps." },
      { icon: "&#x1f3d8;", title: "HOA Contract Scanner", desc: "Decode complex HOA rules, fees, and restrictions before buying." },
      { icon: "&#x26a0;", title: "Risk Scoring", desc: "Every clause rated Low to Critical so you know where to negotiate." },
      { icon: "&#x1f4ac;", title: "Client-Ready Reports", desc: "Export branded PDF reports to share with buyers and sellers." },
      { icon: "&#x1f50d;", title: "Comparison Tool", desc: "Compare two offers side-by-side to find the better deal." },
    ],
    testimonial: '"ContractShield caught a liability clause in a commercial lease that would have cost my client $200K. It pays for itself every single month."',
    testimonialAuthor: "— Sarah M., Commercial Real Estate Agent, Dallas TX",
  },
  freelancers: {
    badge: "For Freelancers & Agencies",
    title: "Stop Signing Contracts<br/><span class='gradient-text'>That Don't Protect You</span>",
    subtitle: "Understand client contracts, SOWs, and NDAs before you sign. Know your rights. Negotiate like a pro.",
    benefitsTitle: "Why 10,000+ Freelancers Trust ContractShield",
    features: [
      { icon: "&#x1f4dd;", title: "SOW Analyzer", desc: "Understand scope, deliverables, and payment terms at a glance." },
      { icon: "&#x1f6e1;", title: "IP Protection Check", desc: "Make sure you own your work. Spot IP assignment traps." },
      { icon: "&#x1f4b8;", title: "Payment Term Scanner", desc: "Check payment schedules, late fees, and kill fee clauses." },
      { icon: "&#x1f4cb;", title: "Template Generator", desc: "Generate professional freelance contracts in seconds." },
      { icon: "&#x1f6a9;", title: "Red Flag Alerts", desc: "Instant warnings about non-compete, indemnification, and scope creep." },
      { icon: "&#x1f4ac;", title: "Ask AI Questions", desc: "\"Is this non-compete enforceable?\" Get answers instantly." },
    ],
    testimonial: '"A client sent me a contract with a 5-year non-compete buried in the fine print. ContractShield flagged it in 10 seconds. Worth every penny."',
    testimonialAuthor: "— Alex K., UX Designer & Freelancer",
  },
  startups: {
    badge: "For Startups & Founders",
    title: "Review Contracts Like You Have<br/><span class='gradient-text'>A $500/hr Lawyer On Speed Dial</span>",
    subtitle: "Investor agreements, vendor contracts, employment offers — analyze them all without burning runway on legal fees.",
    benefitsTitle: "Why Startup Founders Choose ContractShield",
    features: [
      { icon: "&#x1f4c8;", title: "Investor Agreement Review", desc: "Decode SAFE notes, term sheets, and convertible notes." },
      { icon: "&#x1f91d;", title: "Vendor Contract Check", desc: "Spot lock-in clauses, auto-renewals, and hidden costs." },
      { icon: "&#x1f465;", title: "Employment Contracts", desc: "Review offer letters, non-competes, and equity agreements." },
      { icon: "&#x1f4b5;", title: "Save Legal Budget", desc: "Pre-screen contracts before sending to your lawyer. Save 70% on legal." },
      { icon: "&#x26a1;", title: "30-Second Analysis", desc: "Move fast without breaking things. Get results in seconds." },
      { icon: "&#x1f310;", title: "Multi-Language", desc: "Expanding globally? Analyze contracts in any language." },
    ],
    testimonial: '"We analyzed 47 vendor contracts in one afternoon. Found $180K in hidden liability exposure. Our lawyer said it would have taken her 2 weeks."',
    testimonialAuthor: "— Priya R., CTO, Series A Startup",
  },
  hr: {
    badge: "For HR & People Teams",
    title: "Review Employment Contracts<br/><span class='gradient-text'>10x Faster Than Your Legal Team</span>",
    subtitle: "Offer letters, non-competes, severance packages, contractor agreements — analyze and generate them all.",
    benefitsTitle: "Why HR Teams Trust ContractShield",
    features: [
      { icon: "&#x1f4e4;", title: "Offer Letter Review", desc: "Check compensation, benefits, and termination clauses instantly." },
      { icon: "&#x1f6ab;", title: "Non-Compete Analysis", desc: "Know which non-competes are enforceable in which states." },
      { icon: "&#x1f4cb;", title: "Compliance Checker", desc: "Automatic FLSA, ADA, EEOC, and state labor law compliance flags." },
      { icon: "&#x1f4dd;", title: "Template Generator", desc: "Generate offer letters, NDAs, and contractor agreements in seconds." },
      { icon: "&#x1f504;", title: "Batch Processing", desc: "Upload 50 contracts at once for portfolio-wide risk assessment." },
      { icon: "&#x1f4ca;", title: "Team Dashboard", desc: "Track contract risk across your entire organization." },
    ],
    testimonial: '"We standardized 200+ contractor agreements in 3 days instead of 3 months. ContractShield is now required for every new hire contract."',
    testimonialAuthor: "— Jennifer L., VP People, 500-person SaaS company",
  },
  construction: {
    badge: "For Construction & Trades",
    title: "Don't Let a Bad Contract<br/><span class='gradient-text'>Kill Your Next Project</span>",
    subtitle: "Analyze subcontractor agreements, change orders, and insurance requirements in plain English.",
    benefitsTitle: "Why Contractors Trust ContractShield",
    features: [
      { icon: "&#x1f3d7;", title: "Subcontractor Agreements", desc: "Understand scope, liability, and payment terms clearly." },
      { icon: "&#x1f4b0;", title: "Change Order Review", desc: "Spot scope creep and unfair pricing adjustments." },
      { icon: "&#x1f6e1;", title: "Insurance Check", desc: "Verify required coverage levels and indemnification clauses." },
      { icon: "&#x1f4dd;", title: "Quote Generator", desc: "Generate professional project proposals and bid documents." },
      { icon: "&#x26a0;", title: "Lien & Bond Analysis", desc: "Understand lien rights and bonding requirements." },
      { icon: "&#x1f4ac;", title: "Ask Questions", desc: "\"Am I liable if a sub causes damage?\" Get clear answers." },
    ],
    testimonial: '"Caught a $45K liability gap in a subcontractor agreement that would have come out of my pocket. This tool is a must-have for every GC."',
    testimonialAuthor: "— Mike T., General Contractor, Phoenix AZ",
  },
};

function loadSectorPage(sector) {
  const data = SECTORS[sector];
  if (!data) { showPage("home"); return; }

  document.getElementById("sectorBadge").textContent = data.badge;
  document.getElementById("sectorTitle").innerHTML = data.title;
  document.getElementById("sectorSubtitle").textContent = data.subtitle;
  document.getElementById("sectorBenefitsTitle").textContent = data.benefitsTitle;
  document.getElementById("sectorTestimonial").textContent = data.testimonial;
  document.getElementById("sectorTestimonialAuthor").textContent = data.testimonialAuthor;

  const featuresEl = document.getElementById("sectorFeatures");
  featuresEl.innerHTML = data.features.map((f) => `
    <div class="feature-card">
      <div class="feature-icon">${f.icon}</div>
      <h3>${escapeHtml(f.title)}</h3>
      <p>${escapeHtml(f.desc)}</p>
    </div>
  `).join("");

  showPage("sector");
  document.title = "ContractShield AI - " + data.badge;
}

// Override showPage to handle settings
const _origShowPage = showPage;
showPage = function (page) {
  _origShowPage(page);
  if (page === "settings") loadSettings();
};

// Handle /for/sector URLs and payment-success
(function initRouting() {
  const path = window.location.pathname;
  if (path.startsWith("/for/")) {
    loadSectorPage(path.replace("/for/", ""));
  } else if (path === "/payment-success") {
    showPage("payment-success");
    loadUser();
  } else if (path.startsWith("/shared/")) {
    const shareId = path.replace("/shared/", "");
    loadSharedAnalysis(shareId);
  }
})();

// Load user on page load
loadUser();

// ═══════════════════════════════════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════════

function toast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  const t = document.createElement("div");
  t.className = "toast toast-" + type;
  t.textContent = message;
  container.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI CLAUSE REWRITER
// ═══════════════════════════════════════════════════════════════════════════════

async function rewriteClause(index) {
  if (!currentAnalysis?.clauses?.[index]) return;
  const clause = currentAnalysis.clauses[index];
  const btn = document.getElementById("rewrite-btn-" + index);
  const container = document.getElementById("rewrite-result-" + index);

  btn.disabled = true;
  btn.textContent = "Rewriting...";
  container.innerHTML = '<div class="spinner" style="width:24px;height:24px;border-width:2px;margin:0.5rem 0"></div>';
  container.style.display = "block";

  try {
    const isDemo = currentAnalysis.id?.startsWith("demo_");
    if (isDemo) {
      // Demo rewrite
      await new Promise((r) => setTimeout(r, 1000));
      container.innerHTML = `
        <div class="rewrite-result">
          <h5>Suggested Rewrite</h5>
          <div class="rewrite-text">"Both parties agree to mutual indemnification for damages arising from their respective breach of this Agreement. Each party's total liability shall not exceed the total fees paid under this Agreement in the preceding twelve (12) months."</div>
          <ul class="rewrite-changes">
            <li>Made indemnification mutual (both parties share responsibility)</li>
            <li>Added a liability cap tied to contract value</li>
            <li>Clarified scope to breach-related damages only</li>
          </ul>
          <p style="margin-top:0.5rem;font-size:0.8rem;color:var(--primary)"><strong>Negotiation tip:</strong> Present this as "industry standard" mutual indemnification — most reasonable parties will accept this.</p>
        </div>`;
    } else {
      const res = await fetch("/api/rewrite-clause", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          clause_title: clause.title,
          clause_text: clause.summary,
          risk_level: clause.risk_level,
          risk_reason: clause.risk_reason,
          context: currentAnalysis.document_type,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      container.innerHTML = `
        <div class="rewrite-result">
          <h5>Suggested Rewrite</h5>
          <div class="rewrite-text">${escapeHtml(data.rewritten)}</div>
          <ul class="rewrite-changes">${(data.changes_made || []).map((c) => "<li>" + escapeHtml(c) + "</li>").join("")}</ul>
          ${data.negotiation_tip ? `<p style="margin-top:0.5rem;font-size:0.8rem;color:var(--primary)"><strong>Tip:</strong> ${escapeHtml(data.negotiation_tip)}</p>` : ""}
        </div>`;
    }
    toast("Clause rewrite generated!", "success");
  } catch (e) {
    container.innerHTML = `<div class="rewrite-result" style="border-left-color:var(--danger);background:var(--danger-light)">Error: ${escapeHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Rewrite with AI";
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHAREABLE LINKS
// ═══════════════════════════════════════════════════════════════════════════════

async function shareAnalysis() {
  if (!currentAnalysis) return;
  if (!currentUser) { toast("Please log in to share analyses", "warning"); showModal("loginModal"); return; }

  try {
    const res = await fetch("/api/share", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ analysis_id: currentAnalysis.id, data: currentAnalysis, expires_hours: 168 }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    await navigator.clipboard.writeText(data.url);
    toast("Share link copied to clipboard! Valid for 7 days.", "success");
  } catch (e) {
    toast("Failed to create share link: " + e.message, "error");
  }
}

async function loadSharedAnalysis(shareId) {
  showPage("shared");
  try {
    const res = await fetch("/api/shared/" + shareId);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    currentAnalysis = data;
    chatHistory = [];
    showPage("home");
    document.getElementById("upload-section").style.display = "none";
    document.getElementById("resultsSection").style.display = "block";
    renderResults(data);
  } catch (e) {
    document.getElementById("sharedSpinner").style.display = "none";
    document.getElementById("sharedStatus").textContent = "Error: " + e.message;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANNOTATIONS & NOTES
// ═══════════════════════════════════════════════════════════════════════════════

let annotationsCache = {};

function toggleAnnotation(clauseIndex) {
  const formId = "annotation-form-" + clauseIndex;
  const form = document.getElementById(formId);
  if (form) { form.style.display = form.style.display === "none" ? "flex" : "none"; return; }
}

async function saveAnnotation(clauseIndex) {
  if (!currentUser || !currentAnalysis?.id) { toast("Log in to save notes", "warning"); return; }
  const input = document.getElementById("annotation-input-" + clauseIndex);
  const note = input.value.trim();
  if (!note) return;

  try {
    const res = await fetch("/api/annotations", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ analysis_id: currentAnalysis.id, clause_index: clauseIndex, note }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    input.value = "";
    loadAnnotations(currentAnalysis.id);
    toast("Note saved!", "success");
  } catch (e) { toast(e.message, "error"); }
}

async function deleteAnnotation(id) {
  try {
    await fetch("/api/annotations/" + id, { method: "DELETE", headers: authHeaders() });
    if (currentAnalysis?.id) loadAnnotations(currentAnalysis.id);
    toast("Note deleted", "info");
  } catch (e) { toast(e.message, "error"); }
}

async function loadAnnotations(analysisId) {
  if (!currentUser) return;
  try {
    const res = await fetch("/api/annotations/" + analysisId, { headers: authHeaders() });
    const notes = await res.json();
    annotationsCache = {};
    notes.forEach((n) => {
      if (!annotationsCache[n.clause_index]) annotationsCache[n.clause_index] = [];
      annotationsCache[n.clause_index].push(n);
    });
    renderAnnotationsInResults();
  } catch {}
}

function renderAnnotationsInResults() {
  Object.entries(annotationsCache).forEach(([idx, notes]) => {
    const container = document.getElementById("annotations-" + idx);
    if (container) {
      container.innerHTML = notes.map((n) =>
        `<div class="annotation-item"><span>${escapeHtml(n.note)}</span><button class="del-note" onclick="deleteAnnotation(${n.id})">&times;</button></div>`
      ).join("");
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTRACT DEADLINES
// ═══════════════════════════════════════════════════════════════════════════════

async function loadDeadlines() {
  if (!currentUser) {
    document.getElementById("deadlineList").innerHTML = '<p class="empty-state">Log in to track deadlines</p>';
    return;
  }
  try {
    const res = await fetch("/api/deadlines", { headers: authHeaders() });
    const deadlines = await res.json();
    renderDeadlines(deadlines);
  } catch { document.getElementById("deadlineList").innerHTML = '<p class="empty-state">Failed to load deadlines</p>'; }
}

function renderDeadlines(deadlines) {
  const list = document.getElementById("deadlineList");
  if (!deadlines || deadlines.length === 0) {
    list.innerHTML = '<p class="empty-state">No deadlines set. Add one above!</p>';
    return;
  }

  list.innerHTML = deadlines.map((d) => {
    const now = new Date();
    const deadline = new Date(d.deadline_date);
    const daysLeft = Math.ceil((deadline - now) / 86400000);
    const urgency = daysLeft < 0 ? "urgent" : daysLeft <= d.alert_days ? "soon" : "";
    const countdownClass = daysLeft < 0 ? "urgent" : daysLeft <= d.alert_days ? "soon" : "ok";
    const countdownText = daysLeft < 0 ? `${Math.abs(daysLeft)} days overdue` : daysLeft === 0 ? "TODAY" : `${daysLeft} days left`;

    return `<div class="deadline-card ${urgency}">
      <div class="deadline-info">
        <h4>${escapeHtml(d.title)} ${d.is_auto_renewal ? '<span class="auto-renewal-badge">Auto-Renew</span>' : ""}</h4>
        <p>${escapeHtml(d.contract_name || "")} ${d.notes ? "- " + escapeHtml(d.notes) : ""}</p>
        <p style="font-size:0.75rem;color:var(--text-secondary)">${deadline.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
      </div>
      <div style="display:flex;align-items:center;gap:1rem">
        <div class="deadline-countdown ${countdownClass}">${countdownText}</div>
        <button class="history-delete" onclick="deleteDeadline(${d.id})" title="Delete">&times;</button>
      </div>
    </div>`;
  }).join("");
}

async function addDeadline() {
  if (!currentUser) { toast("Log in to track deadlines", "warning"); showModal("loginModal"); return; }
  const title = document.getElementById("dlTitle").value.trim();
  const date = document.getElementById("dlDate").value;
  if (!title || !date) { toast("Title and date are required", "error"); return; }

  try {
    await fetch("/api/deadlines", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        title,
        deadline_date: date,
        contract_name: document.getElementById("dlContract").value.trim(),
        alert_days: parseInt(document.getElementById("dlAlert").value) || 30,
        is_auto_renewal: document.getElementById("dlAutoRenew").checked,
        notes: document.getElementById("dlNotes").value.trim(),
      }),
    });
    document.getElementById("dlTitle").value = "";
    document.getElementById("dlDate").value = "";
    document.getElementById("dlContract").value = "";
    document.getElementById("dlNotes").value = "";
    document.getElementById("dlAutoRenew").checked = false;
    loadDeadlines();
    toast("Deadline added!", "success");
  } catch (e) { toast(e.message, "error"); }
}

async function deleteDeadline(id) {
  await fetch("/api/deadlines/" + id, { method: "DELETE", headers: authHeaders() });
  loadDeadlines();
  toast("Deadline removed", "info");
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLAUSE LIBRARY
// ═══════════════════════════════════════════════════════════════════════════════

async function loadClauseLibrary() {
  const search = document.getElementById("clauseSearch")?.value || "";
  const category = document.getElementById("clauseCategory")?.value || "";
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (category) params.set("category", category);

  try {
    const res = await fetch("/api/clause-library?" + params.toString());
    const data = await res.json();

    // Populate categories dropdown (once)
    const catSelect = document.getElementById("clauseCategory");
    if (catSelect.options.length <= 1 && data.categories) {
      data.categories.forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = c;
        catSelect.appendChild(opt);
      });
    }

    const grid = document.getElementById("clauseLibGrid");
    if (data.clauses.length === 0) {
      grid.innerHTML = '<p class="empty-state">No clauses found matching your search.</p>';
      return;
    }

    grid.innerHTML = data.clauses.map((c) => `
      <div class="clause-lib-item">
        <div class="clause-lib-header">
          <strong>${escapeHtml(c.title)}</strong>
          <span class="clause-lib-cat">${escapeHtml(c.category)}</span>
        </div>
        <div class="clause-lib-text" id="clause-text-${c.id}" onclick="this.classList.toggle('expanded')">${escapeHtml(c.text)}</div>
        <div class="clause-lib-actions">
          <button class="btn btn-sm btn-outline" onclick="copyClauseText('${c.id}')">Copy</button>
        </div>
      </div>
    `).join("");
  } catch {
    document.getElementById("clauseLibGrid").innerHTML = '<p class="empty-state">Failed to load clause library.</p>';
  }
}

function copyClauseText(id) {
  const el = document.getElementById("clause-text-" + id);
  if (el) {
    navigator.clipboard.writeText(el.textContent).then(() => toast("Clause copied to clipboard!", "success"));
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH UPLOAD
// ═══════════════════════════════════════════════════════════════════════════════

const batchDropZone = document.getElementById("batchDropZone");
const batchFileInput = document.getElementById("batchFileInput");

if (batchDropZone) {
  batchDropZone.addEventListener("click", () => batchFileInput.click());
  batchDropZone.addEventListener("dragover", (e) => { e.preventDefault(); batchDropZone.classList.add("dragover"); });
  batchDropZone.addEventListener("dragleave", () => batchDropZone.classList.remove("dragover"));
  batchDropZone.addEventListener("drop", (e) => { e.preventDefault(); batchDropZone.classList.remove("dragover"); if (e.dataTransfer.files.length) handleBatchFiles(e.dataTransfer.files); });
  batchFileInput.addEventListener("change", () => { if (batchFileInput.files.length) handleBatchFiles(batchFileInput.files); });
}

async function handleBatchFiles(files) {
  const formData = new FormData();
  for (const file of files) formData.append("documents", file);

  document.getElementById("batchUploadContent").style.display = "none";
  document.getElementById("batchProgress").style.display = "block";
  document.getElementById("batchProgressText").textContent = `Analyzing ${files.length} contracts...`;

  try {
    const res = await fetch("/api/batch-analyze", { method: "POST", headers: authToken ? { Authorization: "Bearer " + authToken } : {}, body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    renderBatchResults(data);
    toast(`Batch complete: ${data.successful}/${data.total} analyzed`, "success");
  } catch (e) {
    toast("Batch analysis failed: " + e.message, "error");
  } finally {
    document.getElementById("batchUploadContent").style.display = "block";
    document.getElementById("batchProgress").style.display = "none";
    batchFileInput.value = "";
  }
}

function renderBatchResults(data) {
  document.getElementById("batchResults").style.display = "block";
  document.getElementById("batchSummary").innerHTML = `
    <div class="stat-card"><div class="stat-number">${data.total}</div><div class="stat-label">Total Files</div></div>
    <div class="stat-card"><div class="stat-number" style="color:var(--success)">${data.successful}</div><div class="stat-label">Successful</div></div>
    <div class="stat-card"><div class="stat-number" style="color:var(--danger)">${data.failed}</div><div class="stat-label">Failed</div></div>
    <div class="stat-card"><div class="stat-number">${data.average_risk}</div><div class="stat-label">Avg Risk</div></div>
  `;

  document.getElementById("batchResultsList").innerHTML = data.results.map((r, i) => {
    if (r.status === "failed") return `<div class="batch-item failed"><span>${escapeHtml(r.filename)}</span><span style="color:var(--danger)">${escapeHtml(r.error)}</span></div>`;
    const score = r.analysis?.overall_risk_score || 0;
    return `<div class="batch-item" onclick="viewBatchResult(${i})">
      <span><strong>${escapeHtml(r.filename)}</strong> - ${escapeHtml(r.analysis?.document_type || "")}</span>
      <span class="risk-badge risk-${getRiskLevel(score)}">${score}/10</span>
    </div>`;
  }).join("");

  window._batchData = data;
}

function viewBatchResult(index) {
  const r = window._batchData?.results?.[index];
  if (r?.analysis) {
    currentAnalysis = r.analysis;
    chatHistory = [];
    showPage("home");
    document.getElementById("upload-section").style.display = "none";
    document.getElementById("resultsSection").style.display = "block";
    renderResults(r.analysis);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RISK TREND SPARKLINE (in dashboard)
// ═══════════════════════════════════════════════════════════════════════════════

function renderRiskTrend(history) {
  const recent = history.slice(0, 20).reverse();
  if (recent.length < 2) return "<p class='empty-state'>Need 2+ analyses for trend</p>";

  const maxScore = 10;
  const barHeight = 50;
  const bars = recent.map((h) => {
    const score = h.overall_risk_score || 0;
    const pct = (score / maxScore) * barHeight;
    const color = score <= 3 ? "var(--success)" : score <= 5 ? "var(--warning)" : "var(--danger)";
    return `<div class="spark-bar" style="height:${pct}px;background:${color}" title="${h.filename}: ${score}/10"></div>`;
  }).join("");

  const labels = `<div class="risk-trend-labels"><span>${recent[0]?.analyzed_at ? new Date(recent[0].analyzed_at).toLocaleDateString() : ""}</span><span>${recent[recent.length - 1]?.analyzed_at ? new Date(recent[recent.length - 1].analyzed_at).toLocaleDateString() : ""}</span></div>`;

  return `<div class="sparkline">${bars}</div>${labels}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENHANCED RENDERING (add rewrite buttons + annotations to clause rendering)
// ═══════════════════════════════════════════════════════════════════════════════

// Override clause rendering in renderResults
const _origRenderResults = renderResults;
renderResults = function (data) {
  _origRenderResults(data);

  // Add rewrite buttons and annotation UI to each clause
  const clausesList = document.getElementById("clausesList");
  const clauses = clausesList.querySelectorAll(".clause-item");
  clauses.forEach((el, i) => {
    const clause = data.clauses?.[i];
    if (!clause) return;

    // Add rewrite button for medium+ risk
    if (["medium", "high", "critical"].includes(clause.risk_level)) {
      const rewriteHtml = `
        <button class="rewrite-btn" id="rewrite-btn-${i}" onclick="rewriteClause(${i})">Rewrite with AI</button>
        <div id="rewrite-result-${i}" style="display:none"></div>`;
      el.insertAdjacentHTML("beforeend", rewriteHtml);
    }

    // Add annotation UI
    const annotHtml = `
      <div style="margin-top:0.5rem">
        <button class="annotation-btn" onclick="toggleAnnotation(${i})">+ Add Note</button>
        <div class="annotation-form" id="annotation-form-${i}" style="display:none">
          <textarea id="annotation-input-${i}" placeholder="Your note about this clause..."></textarea>
          <button class="btn btn-sm btn-primary" onclick="saveAnnotation(${i})">Save</button>
        </div>
        <div class="annotation-list" id="annotations-${i}"></div>
      </div>`;
    el.insertAdjacentHTML("beforeend", annotHtml);
  });

  // Load annotations if logged in
  if (currentUser && data.id) loadAnnotations(data.id);
};

// Enhanced dashboard with risk trend
const _origRenderDashboard = renderDashboard;
renderDashboard = function () {
  _origRenderDashboard();
  const history = getHistory();

  // Add risk trend to dashboard
  const riskChartEl = document.getElementById("riskChart");
  if (riskChartEl && history.length >= 2) {
    riskChartEl.innerHTML += `<div style="margin-top:1.5rem"><h4 style="font-size:0.9rem;margin-bottom:0.5rem">Risk Trend (Recent)</h4>${renderRiskTrend(history)}</div>`;
  }
};

// Load pages on navigation
const _showPage2 = showPage;
showPage = function (page) {
  _showPage2(page);
  if (page === "clauses") loadClauseLibrary();
  if (page === "deadlines") loadDeadlines();
  if (page === "settings") { loadSettings(); loadFolders(); loadEmailPrefs(); }
};

// ═══════════════════════════════════════════════════════════════════════════════
// OAUTH SSO (Google / Microsoft)
// ═══════════════════════════════════════════════════════════════════════════════

async function oauthLogin(provider) {
  // In production, this would open a popup/redirect to Google/Microsoft OAuth
  // For now, show a helpful message about configuring OAuth
  toast(`${provider.charAt(0).toUpperCase() + provider.slice(1)} SSO requires OAuth Client ID in .env. See docs for setup.`, "info");

  // When OAuth is configured, this flow would:
  // 1. Open popup to provider's auth URL
  // 2. User grants permission
  // 3. Receive auth code/token
  // 4. POST to /api/auth/oauth with provider, token, user info
  // 5. Server validates and returns JWT

  // Example of what the callback would do:
  // const res = await fetch("/api/auth/oauth", {
  //   method: "POST",
  //   headers: { "Content-Type": "application/json" },
  //   body: JSON.stringify({ provider, oauth_id: "...", email: "...", name: "...", avatar: "..." }),
  // });
}

// ═══════════════════════════════════════════════════════════════════════════════
// DOCX EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

async function exportDocx() {
  if (!currentAnalysis) return;
  toast("Generating Word document...", "info");

  try {
    const res = await fetch("/api/export/docx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ analysis: currentAnalysis }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error);
    }

    const blob = await res.blob();
    const filename = `ContractShield_${(currentAnalysis.filename || "report").replace(/\.[^.]+$/, "")}.docx`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast("Word document downloaded!", "success");
  } catch (e) {
    toast("DOCX export failed: " + e.message, "error");
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FOLDERS & TAGS
// ═══════════════════════════════════════════════════════════════════════════════

async function loadFolders() {
  if (!currentUser) return;
  try {
    const res = await fetch("/api/folders", { headers: authHeaders() });
    const folders = await res.json();
    renderFolderList(folders);
  } catch {}
}

function renderFolderList(folders) {
  const list = document.getElementById("folderList");
  if (!list) return;
  if (folders.length === 0) { list.innerHTML = '<p style="font-size:0.85rem;color:var(--text-secondary)">No folders yet</p>'; return; }
  list.innerHTML = folders.map((f) => `
    <div class="folder-item">
      <div class="folder-item-left">
        <div class="folder-dot" style="background:${escapeHtml(f.color)}"></div>
        <span>${escapeHtml(f.name)}</span>
      </div>
      <button class="folder-delete" onclick="deleteFolder(${f.id})">&times;</button>
    </div>
  `).join("");
}

async function createFolder() {
  if (!currentUser) { toast("Log in to create folders", "warning"); return; }
  const name = document.getElementById("newFolderName").value.trim();
  if (!name) { toast("Enter a folder name", "error"); return; }
  const color = document.getElementById("newFolderColor").value;

  try {
    await fetch("/api/folders", { method: "POST", headers: authHeaders(), body: JSON.stringify({ name, color }) });
    document.getElementById("newFolderName").value = "";
    loadFolders();
    toast("Folder created!", "success");
  } catch (e) { toast(e.message, "error"); }
}

async function deleteFolder(id) {
  await fetch("/api/folders/" + id, { method: "DELETE", headers: authHeaders() });
  loadFolders();
  toast("Folder deleted", "info");
}

async function moveToFolder(analysisDbId, folderId) {
  await fetch("/api/auth/history/" + analysisDbId + "/folder", {
    method: "PUT", headers: authHeaders(), body: JSON.stringify({ folder_id: folderId }),
  });
  toast("Moved to folder", "success");
}

async function updateTags(analysisDbId, tags) {
  await fetch("/api/auth/history/" + analysisDbId + "/tags", {
    method: "PUT", headers: authHeaders(), body: JSON.stringify({ tags }),
  });
  toast("Tags updated", "success");
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMAIL PREFERENCES
// ═══════════════════════════════════════════════════════════════════════════════

function loadEmailPrefs() {
  if (!currentUser) return;
  const el1 = document.getElementById("prefNotifications");
  const el2 = document.getElementById("prefDeadlineAlerts");
  const el3 = document.getElementById("prefWeeklyDigest");
  // These default to true (checked), so only uncheck if explicitly set to 0
  if (el1) el1.checked = currentUser.email_notifications !== 0;
  if (el2) el2.checked = currentUser.email_deadline_alerts !== 0;
  if (el3) el3.checked = currentUser.email_weekly_digest !== 0;
}

async function saveEmailPrefs() {
  if (!currentUser) return;
  const prefs = {
    email_notifications: document.getElementById("prefNotifications")?.checked,
    email_deadline_alerts: document.getElementById("prefDeadlineAlerts")?.checked,
    email_weekly_digest: document.getElementById("prefWeeklyDigest")?.checked,
  };
  await fetch("/api/auth/email-prefs", { method: "PUT", headers: authHeaders(), body: JSON.stringify(prefs) });
  toast("Email preferences saved", "success");
}

// ═══════════════════════════════════════════════════════════════════════════════
// ONBOARDING TUTORIAL
// ═══════════════════════════════════════════════════════════════════════════════

const ONBOARDING_STEPS = [
  {
    title: "Welcome to ContractShield AI!",
    subtitle: "Let's take a quick tour of what you can do.",
    features: [
      { icon: "&#x1f4c4;", text: "Upload any contract (PDF or TXT) for instant AI analysis" },
      { icon: "&#x26a0;", text: "Get risk scores, red flags, and negotiation advice" },
      { icon: "&#x1f916;", text: "Ask follow-up questions with AI chat" },
    ],
  },
  {
    title: "Powerful Tools",
    subtitle: "Beyond analysis — here's what else you can do.",
    features: [
      { icon: "&#x1f504;", text: "Compare two contracts side-by-side" },
      { icon: "&#x1f4dd;", text: "Generate professional contracts from templates" },
      { icon: "&#x270f;", text: "Rewrite risky clauses with one click" },
    ],
  },
  {
    title: "Stay Organized",
    subtitle: "Track everything in one place.",
    features: [
      { icon: "&#x1f4ca;", text: "Dashboard with analytics and risk trends" },
      { icon: "&#x23f0;", text: "Set deadline alerts for contract expirations" },
      { icon: "&#x1f4da;", text: "Browse the clause library for standard legal language" },
    ],
  },
  {
    title: "You're All Set!",
    subtitle: "Start by uploading your first contract.",
    features: [
      { icon: "&#x1f680;", text: "Free plan: 3 analyses per month" },
      { icon: "&#x2b50;", text: "Upgrade anytime for unlimited access" },
      { icon: "&#x1f517;", text: "Share analyses with your team via link" },
    ],
  },
];

let onboardingStep = 0;

function showOnboarding() {
  onboardingStep = 0;
  renderOnboardingStep();
}

function renderOnboardingStep() {
  const step = ONBOARDING_STEPS[onboardingStep];
  if (!step) { dismissOnboarding(); return; }

  let overlay = document.getElementById("onboardingOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "onboardingOverlay";
    overlay.className = "onboarding-overlay";
    document.body.appendChild(overlay);
  }

  overlay.style.display = "flex";
  overlay.innerHTML = `
    <div class="onboarding-card">
      <h2>${step.title}</h2>
      <p>${step.subtitle}</p>
      <div class="onboarding-steps">
        ${ONBOARDING_STEPS.map((_, i) => `<div class="onboarding-step ${i === onboardingStep ? "active" : ""}"></div>`).join("")}
      </div>
      <div class="onboarding-features">
        ${step.features.map((f) => `<div class="onboarding-feature"><span class="onboarding-feature-icon">${f.icon}</span><span>${f.text}</span></div>`).join("")}
      </div>
      <div style="display:flex;gap:0.5rem;justify-content:center">
        ${onboardingStep > 0 ? `<button class="btn btn-outline" onclick="onboardingStep--;renderOnboardingStep()">Back</button>` : ""}
        ${onboardingStep < ONBOARDING_STEPS.length - 1
          ? `<button class="btn btn-primary" onclick="onboardingStep++;renderOnboardingStep()">Next</button>`
          : `<button class="btn btn-primary" onclick="dismissOnboarding()">Get Started!</button>`}
        <button class="btn btn-sm" onclick="dismissOnboarding()" style="position:absolute;top:1rem;right:1rem">Skip</button>
      </div>
    </div>`;
}

async function dismissOnboarding() {
  const overlay = document.getElementById("onboardingOverlay");
  if (overlay) overlay.style.display = "none";
  if (currentUser) {
    await fetch("/api/auth/onboarding", { method: "PUT", headers: authHeaders() }).catch(() => {});
  }
}

// Check if onboarding should show after login/signup
const _origUpdateAuthUI = updateAuthUI;
updateAuthUI = function () {
  _origUpdateAuthUI();
  if (currentUser && !currentUser.onboarding_completed) {
    setTimeout(showOnboarding, 500);
    currentUser.onboarding_completed = 1; // Don't show again in this session
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 3: EXECUTIVE SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════

async function generateExecutiveSummary() {
  if (!currentAnalysis) return toast("No analysis loaded", "error");
  toast("Generating executive summary...");
  try {
    const res = await fetch("/api/executive-summary", { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ analysis: currentAnalysis }) });
    const data = await res.json();
    if (data.error) return toast(data.error, "error");

    const html = `<div class="exec-summary">
      <h2>${escapeHtml(data.title || "Executive Brief")}</h2>
      <div class="exec-recommendation exec-rec-${(data.recommendation || "").split(" ")[0]?.toLowerCase()}">${escapeHtml(data.recommendation || "")}</div>
      <p><strong>Bottom Line:</strong> ${escapeHtml(data.one_liner || "")}</p>
      ${data.key_numbers ? `<div class="exec-numbers">${data.key_numbers.map(n => `<div class="exec-num"><strong>${escapeHtml(n.label)}</strong><span>${escapeHtml(n.value)}</span></div>`).join("")}</div>` : ""}
      ${data.top_risks ? `<h4>Top Risks</h4><ul>${data.top_risks.map(r => `<li>${escapeHtml(r)}</li>`).join("")}</ul>` : ""}
      ${data.required_changes ? `<h4>Required Changes Before Signing</h4><ul>${data.required_changes.map(c => `<li>${escapeHtml(c)}</li>`).join("")}</ul>` : ""}
      ${data.timeline ? `<p><strong>Timeline:</strong> ${escapeHtml(data.timeline)}</p>` : ""}
    </div>`;

    const modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.style.display = "flex";
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    modal.innerHTML = `<div class="modal" style="max-width:700px">${html}<button class="btn btn-primary" onclick="this.closest('.modal-overlay').remove()" style="margin-top:1rem">Close</button></div>`;
    document.body.appendChild(modal);
  } catch (e) { toast("Failed to generate summary", "error"); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 3: OBLIGATION TRACKER
// ═══════════════════════════════════════════════════════════════════════════════

async function extractObligations() {
  if (!currentAnalysis) return toast("No analysis loaded", "error");
  toast("Extracting obligations...");
  try {
    const res = await fetch("/api/obligations/extract", { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ analysis: currentAnalysis }) });
    const data = await res.json();
    if (data.error) return toast(data.error, "error");
    toast(`Extracted ${(data.obligations || []).length} obligations`, "success");
    showPage("obligations");
    loadObligations();
  } catch (e) { toast("Failed to extract obligations", "error"); }
}

async function loadObligations() {
  if (!currentUser) return;
  const status = document.getElementById("obligationFilter")?.value || "";
  const url = "/api/obligations" + (status ? `?status=${status}` : "");
  try {
    const res = await fetch(url, { headers: authHeaders() });
    const data = await res.json();
    const el = document.getElementById("obligationList");
    if (!data.length) { el.innerHTML = '<p class="empty-state">No obligations found.</p>'; return; }
    el.innerHTML = data.map(ob => `
      <div class="obligation-card priority-${ob.priority}">
        <div class="ob-header">
          <span class="ob-party">${escapeHtml(ob.party)}</span>
          <span class="badge badge-${ob.priority}">${ob.priority}</span>
          <span class="badge badge-${ob.status}">${ob.status}</span>
        </div>
        <p class="ob-text">${escapeHtml(ob.obligation)}</p>
        <div class="ob-meta">
          ${ob.due_date ? `<span>Due: ${escapeHtml(ob.due_date)}</span>` : ""}
          ${ob.clause_reference ? `<span>Clause: ${escapeHtml(ob.clause_reference)}</span>` : ""}
        </div>
        <div class="ob-actions">
          <select onchange="updateObligation(${ob.id}, 'status', this.value)">
            <option value="pending" ${ob.status === "pending" ? "selected" : ""}>Pending</option>
            <option value="in_progress" ${ob.status === "in_progress" ? "selected" : ""}>In Progress</option>
            <option value="completed" ${ob.status === "completed" ? "selected" : ""}>Completed</option>
          </select>
          <button class="btn btn-sm" onclick="deleteObligation(${ob.id})">Delete</button>
        </div>
      </div>
    `).join("");
  } catch (e) { /* silent */ }
}

async function updateObligation(id, field, value) {
  await fetch(`/api/obligations/${id}`, { method: "PUT", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ [field]: value }) });
  toast("Obligation updated", "success");
}

async function deleteObligation(id) {
  await fetch(`/api/obligations/${id}`, { method: "DELETE", headers: authHeaders() });
  loadObligations();
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 3: NEGOTIATION EMAIL
// ═══════════════════════════════════════════════════════════════════════════════

async function generateNegotiationEmail(clauseTitle, clauseText, riskLevel) {
  const change = prompt("What change do you want to request?");
  if (!change) return;
  toast("Generating negotiation email...");
  try {
    const res = await fetch("/api/negotiation-email", { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ clause_title: clauseTitle, clause_text: clauseText, risk_level: riskLevel, desired_change: change, sender_name: currentUser?.name || "" }) });
    const data = await res.json();
    if (data.error) return toast(data.error, "error");

    const modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.style.display = "flex";
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    modal.innerHTML = `<div class="modal" style="max-width:700px">
      <h3>Negotiation Email</h3>
      <p><strong>Subject:</strong> ${escapeHtml(data.subject || "")}</p>
      <div class="contract-content" style="white-space:pre-wrap">${escapeHtml(data.body || "")}</div>
      <button class="btn btn-primary" onclick="navigator.clipboard.writeText(${JSON.stringify(data.body || "").replace(/</g, "\\u003c")});toast('Copied!','success')" style="margin-top:1rem">Copy Email</button>
      <button class="btn btn-outline" onclick="this.closest('.modal-overlay').remove()" style="margin-top:1rem">Close</button>
    </div>`;
    document.body.appendChild(modal);
  } catch (e) { toast("Failed to generate email", "error"); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 3: BULK ACTIONS
// ═══════════════════════════════════════════════════════════════════════════════

let bulkSelectedIds = new Set();

function toggleBulkSelect(id) {
  if (bulkSelectedIds.has(id)) bulkSelectedIds.delete(id);
  else bulkSelectedIds.add(id);
  document.querySelectorAll(".history-bulk-cb").forEach(cb => { cb.checked = bulkSelectedIds.has(parseInt(cb.dataset.id)); });
  updateBulkBar();
}

function selectAllBulk(checked) {
  document.querySelectorAll(".history-bulk-cb").forEach(cb => {
    const id = parseInt(cb.dataset.id);
    if (checked) bulkSelectedIds.add(id); else bulkSelectedIds.delete(id);
    cb.checked = checked;
  });
  updateBulkBar();
}

function updateBulkBar() {
  let bar = document.getElementById("bulkBar");
  if (!bar) { bar = document.createElement("div"); bar.id = "bulkBar"; bar.className = "bulk-bar"; document.body.appendChild(bar); }
  if (bulkSelectedIds.size === 0) { bar.style.display = "none"; return; }
  bar.style.display = "flex";
  bar.innerHTML = `<span>${bulkSelectedIds.size} selected</span>
    <button class="btn btn-sm btn-outline" onclick="bulkDelete()">Delete</button>
    <button class="btn btn-sm btn-outline" onclick="bulkTag()">Tag</button>
    <button class="btn btn-sm" onclick="bulkSelectedIds.clear();updateBulkBar();renderHistory()">Clear</button>`;
}

async function bulkDelete() {
  if (!confirm(`Delete ${bulkSelectedIds.size} analyses?`)) return;
  await fetch("/api/bulk/delete", { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ ids: [...bulkSelectedIds] }) });
  bulkSelectedIds.clear(); updateBulkBar(); renderHistory(); toast("Deleted", "success");
}

async function bulkTag() {
  const tags = prompt("Enter tags (comma-separated):");
  if (!tags) return;
  await fetch("/api/bulk/tag", { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ ids: [...bulkSelectedIds], tags }) });
  bulkSelectedIds.clear(); updateBulkBar(); renderHistory(); toast("Tagged", "success");
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 3: CALENDAR VIEW
// ═══════════════════════════════════════════════════════════════════════════════

let calendarDate = new Date();
let calendarEvents = [];

function calendarNav(dir) {
  calendarDate.setMonth(calendarDate.getMonth() + dir);
  loadCalendar();
}

async function loadCalendar() {
  if (!currentUser) return;
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const start = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const endDate = new Date(year, month + 1, 0);
  const end = `${year}-${String(month + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;

  document.getElementById("calendarMonth").textContent = calendarDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  try {
    const res = await fetch(`/api/calendar?start=${start}&end=${end}`, { headers: authHeaders() });
    calendarEvents = await res.json();
  } catch (e) { calendarEvents = []; }

  renderCalendar(year, month);
}

function renderCalendar(year, month) {
  const grid = document.getElementById("calendarGrid");
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date().toISOString().split("T")[0];

  let html = '<div class="cal-header">Sun</div><div class="cal-header">Mon</div><div class="cal-header">Tue</div><div class="cal-header">Wed</div><div class="cal-header">Thu</div><div class="cal-header">Fri</div><div class="cal-header">Sat</div>';
  for (let i = 0; i < firstDay; i++) html += '<div class="cal-day empty"></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dayEvents = calendarEvents.filter(e => (e.date || "").startsWith(dateStr));
    const isToday = dateStr === today;
    html += `<div class="cal-day ${isToday ? "today" : ""} ${dayEvents.length ? "has-events" : ""}" onclick="showCalendarDay('${dateStr}')">
      <span class="cal-date">${d}</span>
      <div class="cal-dots">${dayEvents.slice(0, 3).map(e => `<span class="cal-dot" style="background:${e.color}" title="${escapeHtml(e.title)}"></span>`).join("")}</div>
    </div>`;
  }
  grid.innerHTML = html;
}

function showCalendarDay(dateStr) {
  const dayEvents = calendarEvents.filter(e => (e.date || "").startsWith(dateStr));
  const detailsEl = document.getElementById("calendarEventDetails");
  if (!dayEvents.length) { detailsEl.style.display = "none"; return; }
  detailsEl.style.display = "block";
  document.getElementById("calendarEventTitle").textContent = `Events on ${new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}`;
  document.getElementById("calendarEventContent").innerHTML = dayEvents.map(e => `
    <div class="cal-event-item" style="border-left:3px solid ${e.color}">
      <strong>${escapeHtml(e.title)}</strong>
      <span class="badge">${e.type}</span>
      ${e.details ? `<div class="cal-event-details">${Object.entries(e.details).map(([k, v]) => `<span>${k}: ${v}</span>`).join(" | ")}</div>` : ""}
    </div>
  `).join("");
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 3: APPROVAL WORKFLOWS
// ═══════════════════════════════════════════════════════════════════════════════

async function submitForApproval(analysisId, title) {
  const t = title || prompt("Approval title:");
  if (!t) return;
  try {
    const res = await fetch("/api/approvals", { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ analysis_id: analysisId, title: t }) });
    const data = await res.json();
    if (data.error) return toast(data.error, "error");
    toast("Submitted for approval", "success");
  } catch (e) { toast("Failed", "error"); }
}

async function loadApprovals() {
  if (!currentUser) return;
  const status = document.getElementById("approvalFilter")?.value || "";
  const url = "/api/approvals" + (status ? `?status=${status}` : "");
  try {
    const res = await fetch(url, { headers: authHeaders() });
    const data = await res.json();

    // Stats
    const statsRes = await fetch("/api/approvals/stats", { headers: authHeaders() });
    const stats = await statsRes.json();
    document.getElementById("approvalStats").innerHTML = `
      <div class="dashboard-stats"><div class="stat-card"><div class="stat-number">${stats.pending}</div><div class="stat-label">Pending</div></div>
      <div class="stat-card"><div class="stat-number" style="color:#16a34a">${stats.approved}</div><div class="stat-label">Approved</div></div>
      <div class="stat-card"><div class="stat-number" style="color:#dc2626">${stats.rejected}</div><div class="stat-label">Rejected</div></div></div>`;

    const el = document.getElementById("approvalList");
    if (!data.length) { el.innerHTML = '<p class="empty-state">No approval workflows.</p>'; return; }
    el.innerHTML = data.map(w => `
      <div class="approval-card status-${w.status}">
        <div class="approval-header">
          <strong>${escapeHtml(w.title)}</strong>
          <span class="badge badge-${w.status}">${w.status.replace(/_/g, " ")}</span>
        </div>
        <div class="approval-meta">Step ${w.current_step}/${w.total_steps} | Submitted ${new Date(w.submitted_at).toLocaleDateString()}</div>
        ${w.comments.length ? `<div class="approval-comments">${w.comments.map(c => `<div class="approval-comment"><strong>${escapeHtml(c.user_name)}</strong> ${c.action}${c.comment ? ": " + escapeHtml(c.comment) : ""}</div>`).join("")}</div>` : ""}
        ${w.status !== "approved" && w.status !== "rejected" ? `<div class="approval-actions">
          <button class="btn btn-sm btn-primary" onclick="reviewApproval(${w.id},'approve')">Approve</button>
          <button class="btn btn-sm btn-outline" onclick="reviewApproval(${w.id},'request_changes')">Request Changes</button>
          <button class="btn btn-sm" onclick="reviewApproval(${w.id},'reject')" style="color:#dc2626">Reject</button>
        </div>` : ""}
      </div>
    `).join("");
  } catch (e) { /* silent */ }
}

async function reviewApproval(id, action) {
  const comment = action !== "approve" ? prompt("Comment (optional):") : "";
  try {
    const res = await fetch(`/api/approvals/${id}/review`, { method: "PUT", headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ action, comment: comment || "" }) });
    const data = await res.json();
    if (data.error) return toast(data.error, "error");
    toast(`${action.replace("_", " ")} successful`, "success");
    loadApprovals();
  } catch (e) { toast("Failed", "error"); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 3: ADMIN ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════════

async function loadAdminAnalytics() {
  if (!currentUser) return;
  const period = document.getElementById("analyticsPeriod")?.value || "30d";
  try {
    const res = await fetch(`/api/admin/analytics?period=${period}`, { headers: authHeaders() });
    const data = await res.json();
    if (data.error) return toast(data.error, "error");

    document.getElementById("adminStats").innerHTML = `
      <div class="stat-card"><div class="stat-number">${data.total_analyses}</div><div class="stat-label">Analyses</div></div>
      <div class="stat-card"><div class="stat-number">${data.avg_risk_score}</div><div class="stat-label">Avg Risk</div></div>
      <div class="stat-card"><div class="stat-number">${data.risk_distribution?.high || 0}</div><div class="stat-label">High Risk</div></div>
      <div class="stat-card"><div class="stat-number">${data.risk_distribution?.critical || 0}</div><div class="stat-label">Critical</div></div>`;

    // Daily activity chart
    const maxCount = Math.max(...(data.daily_activity || []).map(d => d.count), 1);
    document.getElementById("adminDailyChart").innerHTML = (data.daily_activity || []).map(d =>
      `<div class="bar-row"><span class="bar-label">${d.day.substring(5)}</span><div class="bar" style="width:${(d.count / maxCount) * 100}%">${d.count}</div></div>`
    ).join("") || '<p class="empty-state">No activity</p>';

    // Doc types
    document.getElementById("adminDocTypes").innerHTML = (data.document_types || []).map(d =>
      `<div class="bar-row"><span class="bar-label">${escapeHtml(d.document_type || "Unknown")}</span><div class="bar" style="width:${Math.min(100, d.count * 10)}%">${d.count}</div></div>`
    ).join("") || '<p class="empty-state">No data</p>';

    // Members
    document.getElementById("adminMembers").innerHTML = (data.members || []).map(m =>
      `<div class="member-row"><strong>${escapeHtml(m.name)}</strong><span>${m.recent_analyses} analyses</span><span>Avg risk: ${m.avg_risk ? m.avg_risk.toFixed(1) : "N/A"}</span><span>Last: ${m.last_active ? new Date(m.last_active).toLocaleDateString() : "Never"}</span></div>`
    ).join("") || '<p class="empty-state">No team members</p>';

    // Risk distribution
    const rd = data.risk_distribution || {};
    document.getElementById("adminRiskDist").innerHTML = `
      <div class="risk-dist-bar"><div class="risk-seg low" style="flex:${rd.low || 0}"></div><div class="risk-seg med" style="flex:${rd.medium || 0}"></div><div class="risk-seg high" style="flex:${rd.high || 0}"></div><div class="risk-seg crit" style="flex:${rd.critical || 0}"></div></div>
      <div class="risk-dist-legend"><span>Low: ${rd.low || 0}</span><span>Medium: ${rd.medium || 0}</span><span>High: ${rd.high || 0}</span><span>Critical: ${rd.critical || 0}</span></div>`;
  } catch (e) { /* silent */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 3: INTEGRATIONS (SLACK/TEAMS/DISCORD)
// ═══════════════════════════════════════════════════════════════════════════════

async function addIntegration() {
  const type = document.getElementById("integrationType").value;
  const name = document.getElementById("integrationName").value;
  const url = document.getElementById("integrationUrl").value;
  if (!url) return toast("Webhook URL required", "error");

  try {
    const res = await fetch("/api/integrations", { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ type, name, config: { webhook_url: url } }) });
    const data = await res.json();
    if (data.error) return toast(data.error, "error");
    toast("Integration added!", "success");
    document.getElementById("integrationName").value = "";
    document.getElementById("integrationUrl").value = "";
    loadIntegrations();
  } catch (e) { toast("Failed", "error"); }
}

async function loadIntegrations() {
  if (!currentUser) return;
  try {
    const res = await fetch("/api/integrations", { headers: authHeaders() });
    const data = await res.json();
    const el = document.getElementById("integrationList");
    if (!data.length) { el.innerHTML = '<p class="empty-state">No integrations.</p>'; return; }
    el.innerHTML = data.map(i => `
      <div class="integration-row">
        <span class="integration-type">${i.type.toUpperCase()}</span>
        <span>${escapeHtml(i.name)}</span>
        <span class="badge ${i.is_active ? "badge-active" : "badge-inactive"}">${i.is_active ? "Active" : "Inactive"}</span>
        <button class="btn btn-sm btn-outline" onclick="testIntegration(${i.id})">Test</button>
        <button class="btn btn-sm" onclick="deleteIntegration(${i.id})">Remove</button>
      </div>
    `).join("");
  } catch (e) { /* silent */ }
}

async function testIntegration(id) {
  try {
    const res = await fetch("/api/integrations/test", { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    const data = await res.json();
    toast(data.success ? "Test sent!" : data.error, data.success ? "success" : "error");
  } catch (e) { toast("Failed", "error"); }
}

async function deleteIntegration(id) {
  await fetch(`/api/integrations/${id}`, { method: "DELETE", headers: authHeaders() });
  loadIntegrations();
  toast("Removed", "success");
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 3: RISK RULES
// ═══════════════════════════════════════════════════════════════════════════════

async function loadRiskRules() {
  try {
    const res = await fetch("/api/risk-rules", { headers: authHeaders() });
    return await res.json();
  } catch (e) { return []; }
}

async function evaluateRiskRules(analysis) {
  try {
    const res = await fetch("/api/risk-rules/evaluate", { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ analysis }) });
    return await res.json();
  } catch (e) { return { violations: [], passed: true }; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 3: INDUSTRY PROFILES
// ═══════════════════════════════════════════════════════════════════════════════

async function setIndustryProfile(industry) {
  try {
    await fetch("/api/auth/industry", { method: "PUT", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ industry }) });
    toast("Industry profile updated", "success");
  } catch (e) { toast("Failed", "error"); }
}

async function loadIndustryProfiles() {
  try {
    const res = await fetch("/api/industry-profiles");
    return await res.json();
  } catch (e) { return []; }
}
