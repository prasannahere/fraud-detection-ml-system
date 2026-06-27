export type PredictionLabel = "Fraud" | "Normal";

export type TransactionRecord = {
  id: string;
  transactionId?: number;
  timestamp: number;
  timestampLabel: string;
  amount?: number;
  fraudScore: number;
  prediction: PredictionLabel;
  decision: string;
  source: "stream" | "batch" | "manual";
  raw: Record<string, unknown>;
};

export type ShapFeature = {
  feature: string;
  shap_value: number;
};

export type ExplainData = {
  fraud_probability: number;
  decision: string;
  threshold_used: number;
  positive_contributors: ShapFeature[];
  negative_contributors: ShapFeature[];
};

export type FeatureDriftItem = {
  feature: string;
  drift_score: number;
  status: string;
  batch_mean: number;
  training_mean: number;
};

export type FeatureDriftData = {
  drift_detected: boolean;
  high_drift_count: number;
  message?: string | null;
  features: FeatureDriftItem[];
};

export type KpiMetrics = {
  total: number;
  fraudDetected: number;
  fraudRate: number;
  avgRiskScore: number;
};

export type SortKey = "transactionId" | "timestamp" | "amount" | "fraudScore" | "prediction";
export type SortDir = "asc" | "desc";
export type PredictionFilter = "all" | "fraud" | "normal";

export type DashboardPanelId = "timeline" | "monitor" | "explain" | "drift";
