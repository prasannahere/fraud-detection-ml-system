import type { PredictionLabel, TransactionRecord } from "../types";

export const FRAUD_THRESHOLD = 0.8;

export function toTransaction(row: Record<string, unknown>): Record<string, unknown> {
  const tx: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (["isFraud", "Delta"].includes(k)) continue;
    if (v === null || v === undefined || v === "") continue;
    tx[k] = v;
  }
  return tx;
}

export function predictionFromScore(score: number, threshold = FRAUD_THRESHOLD): PredictionLabel {
  return score >= threshold ? "Fraud" : "Normal";
}

export function decisionFromScore(score: number, threshold = FRAUD_THRESHOLD): string {
  if (score >= 0.85) return "BLOCK";
  if (score >= threshold) return "REVIEW";
  return "APPROVE";
}

export function buildTransactionRecord(
  raw: Record<string, unknown>,
  fraudScore: number,
  source: TransactionRecord["source"],
  threshold = FRAUD_THRESHOLD
): TransactionRecord {
  const ts = Date.now();
  return {
    id: crypto.randomUUID(),
    transactionId: raw.TransactionID as number | undefined,
    timestamp: ts,
    timestampLabel: new Date(ts).toLocaleString(),
    amount: raw.TransactionAmt as number | undefined,
    fraudScore,
    prediction: predictionFromScore(fraudScore, threshold),
    decision: decisionFromScore(fraudScore, threshold),
    source,
    raw,
  };
}
