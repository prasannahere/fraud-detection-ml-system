const STORAGE_KEY = "fraud_prediction_history";
const SETTINGS_KEY = "fraud_dashboard_settings";
const TOKEN_KEY = "fraud_access_token";

const NUMERIC_FIELDS = new Set([
  "TransactionID", "TransactionDT", "TransactionAmt", "card1", "card2", "card3",
  "card5", "addr1", "addr2", "dist1", "dist2",
  "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11", "C12", "C13", "C14",
  "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "D11", "D12", "D13", "D14", "D15",
]);

const SKIP_CSV_COLS = new Set(["isFraud", "Delta"]);

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function getSettings() {
  return {
    apiBase: document.getElementById("apiBase").value.trim() || window.location.origin,
    threshold: parseFloat(document.getElementById("threshold").value) || 0.82,
  };
}

function applySavedSettings() {
  const saved = loadSettings();
  if (saved.apiBase) document.getElementById("apiBase").value = saved.apiBase;
  if (saved.threshold != null) document.getElementById("threshold").value = saved.threshold;
  if (saved.username) document.getElementById("username").value = saved.username;
  updateAuthStatus();
}

function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || "";
}

function setToken(token) {
  if (token) {
    sessionStorage.setItem(TOKEN_KEY, token);
  } else {
    sessionStorage.removeItem(TOKEN_KEY);
  }
  updateAuthStatus();
}

function updateAuthStatus() {
  const el = document.getElementById("authStatus");
  const token = getToken();
  el.textContent = token ? "Signed in — JWT active" : "Not signed in — login required for predictions";
  el.style.color = token ? "var(--green)" : "var(--muted)";
}

function headers() {
  const h = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

async function login() {
  hideError();
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  if (!username || !password) {
    showError("Username and password are required.");
    return;
  }

  const data = await apiFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
    auth: false,
  });

  setToken(data.access_token);
  const saved = loadSettings();
  saveSettings({ ...saved, username, apiBase: getSettings().apiBase, threshold: getSettings().threshold });
}

function logout() {
  setToken("");
  document.getElementById("password").value = "";
}

function showError(msg) {
  const el = document.getElementById("errorBanner");
  el.textContent = msg;
  el.classList.remove("hidden");
}

function hideError() {
  document.getElementById("errorBanner").classList.add("hidden");
}

async function apiFetch(path, options = {}) {
  const { apiBase } = getSettings();
  const url = `${apiBase.replace(/\/$/, "")}${path}`;
  const useAuth = options.auth !== false;
  const requestHeaders = useAuth ? headers() : { "Content-Type": "application/json" };
  const resp = await fetch(url, {
    ...options,
    headers: { ...requestHeaders, ...options.headers },
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    if (resp.status === 401 && useAuth) {
      setToken("");
    }
    const detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail || resp.statusText);
    throw new Error(detail);
  }
  return data;
}

function decisionLabel(decision) {
  if (decision === "BLOCK") return { text: "Fraud", cls: "fraud" };
  if (decision === "REVIEW") return { text: "Review", cls: "review" };
  return { text: "Not Fraud", cls: "safe" };
}

function riskLevel(prob) {
  if (prob >= 0.85) return "High";
  if (prob >= 0.6) return "Medium";
  return "Low";
}

function riskColor(prob) {
  if (prob >= 0.85) return "var(--red)";
  if (prob >= 0.6) return "var(--amber)";
  return "var(--green)";
}

function parseFormTransaction() {
  const form = document.getElementById("transactionForm");
  const fd = new FormData(form);
  const tx = {};
  for (const [key, value] of fd.entries()) {
    if (value === "") continue;
    if (NUMERIC_FIELDS.has(key)) {
      const n = Number(value);
      if (!Number.isNaN(n)) tx[key] = n;
    } else {
      tx[key] = value;
    }
  }
  if (!tx.TransactionDT || !tx.TransactionAmt) {
    throw new Error("TransactionDT and TransactionAmt are required.");
  }
  return tx;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error("CSV must have a header row and at least one data row.");

  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = lines[i].split(",");
    const row = {};
    headers.forEach((h, idx) => {
      if (SKIP_CSV_COLS.has(h)) return;
      const raw = (values[idx] || "").trim();
      if (raw === "" || raw.toLowerCase() === "nan") return;
      if (NUMERIC_FIELDS.has(h)) {
        const n = Number(raw);
        if (!Number.isNaN(n)) row[h] = n;
      } else {
        row[h] = raw;
      }
    });
    if (row.TransactionDT != null && row.TransactionAmt != null) {
      rows.push(row);
    }
  }

  if (!rows.length) throw new Error("No valid rows found. Each row needs TransactionDT and TransactionAmt.");
  return rows;
}

function renderPredictionResult(data, shapFeatures = null) {
  const prob = data.fraud_probability;
  const dec = decisionLabel(data.decision);
  const threshold = data.threshold_used;

  document.getElementById("resultPanel").classList.remove("hidden");
  document.getElementById("probValue").textContent = (prob * 100).toFixed(1) + "%";
  document.getElementById("probValue").style.color = riskColor(prob);
  document.getElementById("riskLevel").textContent = riskLevel(prob);
  document.getElementById("thresholdUsed").textContent = threshold.toFixed(2);

  const badge = document.getElementById("decisionBadge");
  badge.textContent = dec.text;
  badge.className = `decision-badge ${dec.cls}`;

  const fill = document.getElementById("riskBarFill");
  fill.style.width = `${Math.min(prob * 100, 100)}%`;
  fill.style.background = riskColor(prob);

  renderShap(shapFeatures || []);
}

function renderShap(features) {
  const list = document.getElementById("shapList");
  list.innerHTML = "";

  if (!features.length) {
    list.innerHTML = '<li class="empty-state">Run prediction with SHAP to see top reasons.</li>';
    return;
  }

  const maxAbs = Math.max(...features.map((f) => Math.abs(f.shap_value)), 0.001);

  features.forEach((f) => {
    const li = document.createElement("li");
    li.className = "shap-item";
    const pct = (Math.abs(f.shap_value) / maxAbs) * 100;
    const cls = f.shap_value >= 0 ? "pos" : "neg";
    li.innerHTML = `
      <span class="name" title="${f.feature}">${f.feature}</span>
      <div class="shap-bar-wrap"><div class="shap-bar ${cls}" style="width:${pct}%"></div></div>
      <span class="shap-val">${f.shap_value >= 0 ? "+" : ""}${f.shap_value.toFixed(4)}</span>
    `;
    list.appendChild(li);
  });
}

function renderBatchTable(predictions) {
  const tbody = document.getElementById("batchBody");
  tbody.innerHTML = "";
  document.getElementById("batchPanel").classList.remove("hidden");

  predictions.forEach((p) => {
    const dec = decisionLabel(p.decision);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${p.index + 1}</td>
      <td>${(p.fraud_probability * 100).toFixed(2)}%</td>
      <td><span class="decision-badge ${dec.cls}" style="font-size:0.7rem;padding:0.2rem 0.6rem">${dec.text}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveHistory(entry) {
  const history = loadHistory();
  history.unshift({ ...entry, ts: new Date().toISOString() });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 100)));
  renderHistory();
  renderAnalytics();
}

function renderHistory() {
  const history = loadHistory();
  const tbody = document.getElementById("historyBody");
  tbody.innerHTML = "";

  if (!history.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No predictions yet.</td></tr>';
    return;
  }

  history.slice(0, 20).forEach((h) => {
    const dec = decisionLabel(h.decision);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${new Date(h.ts).toLocaleString()}</td>
      <td>${h.transactionId ?? "—"}</td>
      <td>${(h.fraud_probability * 100).toFixed(1)}%</td>
      <td><span class="decision-badge ${dec.cls}" style="font-size:0.7rem;padding:0.2rem 0.6rem">${dec.text}</span></td>
      <td>${h.threshold_used?.toFixed(2) ?? "—"}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderAnalytics() {
  const history = loadHistory();
  const total = history.length;
  const fraud = history.filter((h) => h.decision === "BLOCK").length;
  const review = history.filter((h) => h.decision === "REVIEW").length;
  const safe = history.filter((h) => h.decision === "APPROVE").length;
  const avgProb = total
    ? history.reduce((s, h) => s + h.fraud_probability, 0) / total
    : 0;

  document.getElementById("statTotal").textContent = total;
  document.getElementById("statFraud").textContent = fraud;
  document.getElementById("statReview").textContent = review;
  document.getElementById("statSafe").textContent = safe;
  document.getElementById("statAvgProb").textContent = (avgProb * 100).toFixed(1) + "%";

  const chart = document.getElementById("probChart");
  chart.innerHTML = "";
  const recent = history.slice(0, 15).reverse();
  if (!recent.length) return;

  recent.forEach((h) => {
    const bar = document.createElement("div");
    bar.className = "chart-bar";
    bar.style.height = `${Math.max(h.fraud_probability * 100, 4)}%`;
    bar.title = `${(h.fraud_probability * 100).toFixed(1)}%`;
    chart.appendChild(bar);
  });
}

async function refreshHealth() {
  const pill = document.getElementById("healthPill");
  try {
    const data = await apiFetch("/health", { auth: false });
    pill.textContent = data.status === "ok" ? "API ready" : "API degraded";
    pill.className = `status-pill ${data.status === "ok" ? "ok" : "degraded"}`;
    pill.title = `model=${data.model_loaded} encoders=${data.encoders_loaded} aligned=${data.features_aligned}`;
  } catch (e) {
    pill.textContent = "API offline";
    pill.className = "status-pill error";
    pill.title = e.message;
  }
}

async function predictSingle(withShap = true) {
  hideError();
  if (!getToken()) {
    throw new Error("Sign in first to run predictions.");
  }
  const tx = parseFormTransaction();
  const { threshold } = getSettings();
  const q = threshold ? `?threshold=${threshold}` : "";

  const predictData = await apiFetch(`/predict${q}`, {
    method: "POST",
    body: JSON.stringify(tx),
  });

  let shapFeatures = [];
  if (withShap) {
    try {
      const params = new URLSearchParams();
      if (threshold) params.set("threshold", String(threshold));
      params.set("top_k", "10");
      const explainData = await apiFetch(`/explain?${params}`, {
        method: "POST",
        body: JSON.stringify(tx),
      });
      shapFeatures = explainData.top_features || [];
    } catch {
      shapFeatures = [];
    }
  }

  renderPredictionResult(predictData, shapFeatures);
  saveHistory({
    fraud_probability: predictData.fraud_probability,
    decision: predictData.decision,
    threshold_used: predictData.threshold_used,
    transactionId: tx.TransactionID,
  });
}

async function predictBatchRows(rows) {
  hideError();
  if (!getToken()) {
    throw new Error("Sign in first to run batch predictions.");
  }
  const { threshold } = getSettings();
  const q = threshold ? `?threshold=${threshold}` : "";

  const data = await apiFetch(`/predict_batch${q}`, {
    method: "POST",
    body: JSON.stringify({ transactions: rows }),
  });

  renderBatchTable(data.predictions);
  data.predictions.forEach((p, i) => {
    saveHistory({
      fraud_probability: p.fraud_probability,
      decision: p.decision,
      threshold_used: data.threshold_used,
      transactionId: rows[i]?.TransactionID,
    });
  });
}

function wireEvents() {
  document.getElementById("loginBtn").addEventListener("click", async () => {
    try {
      document.getElementById("loginBtn").disabled = true;
      await login();
    } catch (e) {
      showError(e.message);
    } finally {
      document.getElementById("loginBtn").disabled = false;
    }
  });

  document.getElementById("logoutBtn").addEventListener("click", () => {
    logout();
  });

  document.getElementById("predictBtn").addEventListener("click", async () => {
    try {
      document.getElementById("predictBtn").disabled = true;
      await predictSingle(true);
    } catch (e) {
      showError(e.message);
    } finally {
      document.getElementById("predictBtn").disabled = false;
    }
  });

  document.getElementById("batchBtn").addEventListener("click", async () => {
    const file = document.getElementById("csvFile").files[0];
    if (!file) {
      showError("Choose a CSV file first.");
      return;
    }
    try {
      document.getElementById("batchBtn").disabled = true;
      const text = await file.text();
      const rows = parseCsv(text);
      await predictBatchRows(rows);
    } catch (e) {
      showError(e.message);
    } finally {
      document.getElementById("batchBtn").disabled = false;
    }
  });

  document.getElementById("csvDrop").addEventListener("click", () => {
    document.getElementById("csvFile").click();
  });

  document.getElementById("csvFile").addEventListener("change", (e) => {
    const name = e.target.files[0]?.name;
    document.getElementById("csvLabel").textContent = name ? `Selected: ${name}` : "Drop CSV or click to upload";
  });

  ["apiBase", "threshold", "username"].forEach((id) => {
    document.getElementById(id).addEventListener("change", () => {
      const saved = loadSettings();
      saveSettings({
        ...saved,
        apiBase: getSettings().apiBase,
        threshold: getSettings().threshold,
        username: document.getElementById("username").value.trim(),
      });
    });
  });

  document.getElementById("clearHistory").addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    renderHistory();
    renderAnalytics();
  });
}

applySavedSettings();
wireEvents();
renderHistory();
renderAnalytics();
refreshHealth();
setInterval(refreshHealth, 30000);
