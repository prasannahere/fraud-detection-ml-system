import type { ExplainData, FeatureDriftData } from "./types";

const FRAUD_API = import.meta.env.VITE_FRAUD_API_URL || "http://localhost:8000";
const STREAM_API = import.meta.env.VITE_STREAM_API_URL || "http://localhost:8001";

const HEALTH_RETRIES = 3;
const HEALTH_RETRY_DELAY_MS = 500;

let token = sessionStorage.getItem("fraud_jwt") || "";

export function setToken(value: string) {
  token = value;
  if (value) sessionStorage.setItem("fraud_jwt", value);
  else sessionStorage.removeItem("fraud_jwt");
}

export function getToken() {
  return token;
}

async function fetchWithRetry(url: string, retries = HEALTH_RETRIES): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const resp = await fetch(url);
      if (resp.ok) return resp;
      lastError = new Error(`HTTP ${resp.status}`);
    } catch (err) {
      lastError = err;
    }
    if (attempt < retries - 1) {
      await new Promise((resolve) => setTimeout(resolve, HEALTH_RETRY_DELAY_MS * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Health check failed");
}

async function fraudFetch<T>(path: string, options: RequestInit = {}, auth = true) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  const started = performance.now();
  const resp = await fetch(`${FRAUD_API}${path}`, { ...options, headers });
  const latencyMs = Math.round(performance.now() - started);

  const data = (await resp.json().catch(() => ({}))) as T & { detail?: string };
  if (!resp.ok) {
    if (resp.status === 401) setToken("");
    throw new Error(typeof data.detail === "string" ? data.detail : "Request failed");
  }
  return { data, latencyMs };
}

export async function login(username: string, password: string) {
  const { data } = await fraudFetch<{ access_token: string }>(
    "/auth/login",
    { method: "POST", body: JSON.stringify({ username, password }) },
    false
  );
  setToken(data.access_token);
  return data;
}

export async function predict(transaction: Record<string, unknown>, threshold: number) {
  return fraudFetch<{
    fraud_probability: number;
    decision: string;
    threshold_used: number;
  }>(`/predict?threshold=${threshold}`, {
    method: "POST",
    body: JSON.stringify(transaction),
  });
}

export async function predictBatch(transactions: Record<string, unknown>[], threshold: number) {
  return fraudFetch<{
    predictions: Array<{
      index: number;
      fraud_probability: number;
      decision: string;
    }>;
    threshold_used: number;
  }>(`/predict_batch?threshold=${threshold}`, {
    method: "POST",
    body: JSON.stringify({ transactions }),
  });
}

export async function explain(
  transaction: Record<string, unknown>,
  threshold: number,
  topK = 8
) {
  return fraudFetch<ExplainData>(`/explain?threshold=${threshold}&top_k=${topK}`, {
    method: "POST",
    body: JSON.stringify(transaction),
  });
}

export async function driftMonitor(transactions: Record<string, unknown>[]) {
  return fraudFetch<FeatureDriftData>("/drift/monitor", {
    method: "POST",
    body: JSON.stringify({ transactions }),
  });
}

export async function healthFraud() {
  const resp = await fetchWithRetry(`${FRAUD_API}/health`);
  return resp.json() as Promise<{ status: string }>;
}

export async function healthStream() {
  const resp = await fetchWithRetry(`${STREAM_API}/health`);
  return resp.json();
}

export function streamUrl() {
  return `${STREAM_API}/stream`;
}

export async function fetchBatchSample(limit = 30) {
  const resp = await fetch(`${STREAM_API}/batch?limit=${limit}`);
  if (!resp.ok) throw new Error("Failed to load batch sample");
  return resp.json() as Promise<{ transactions: Record<string, unknown>[] }>;
}

export { FRAUD_API, STREAM_API };
