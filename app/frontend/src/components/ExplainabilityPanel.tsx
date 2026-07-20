import type { ExplainData, TransactionRecord } from "../types";
import { formatAmount, formatPercent } from "../utils/format";

type Props = {
  transaction: TransactionRecord | null;
  explain: ExplainData | null;
  loading: boolean;
  expanded?: boolean;
};

function shortLabel(label: string, max = 22) {
  if (label.length <= max) return label;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${label.slice(0, head)}…${label.slice(label.length - tail)}`;
}

export function ExplainabilityPanel({ transaction, explain, loading, expanded = false }: Props) {
  const positive = explain?.positive_contributors ?? [];
  const negative = explain?.negative_contributors ?? [];
  const maxFeatures = expanded ? 12 : 6;

  const ranked = [...positive, ...negative]
    .sort((a, b) => Math.abs(b.shap_value) - Math.abs(a.shap_value))
    .slice(0, maxFeatures);

  const maxAbs = Math.max(...ranked.map((f) => Math.abs(f.shap_value)), 0.001);
  const score = explain?.fraud_probability ?? transaction?.fraudScore;

  return (
    <section className={`panel panel-fill ${expanded ? "panel-expanded" : ""}`}>
      <div className="panel-header">
        <div>
          <h2 className="panel-title">
            <span className="material-symbols-outlined">psychology</span>
            Explainability
          </h2>
          <p className="panel-subtitle">SHAP attribution · XGBoost IEEE-CIS</p>
        </div>
        {transaction && (
          <span className={`pill ${transaction.prediction === "Fraud" ? "pill-danger" : "pill-safe"}`}>
            {transaction.prediction}
          </span>
        )}
      </div>

      <div className="panel-body explain-body">
        {!transaction ? (
          <div className="empty-state">
            <span className="material-symbols-outlined">touch_app</span>
            Select a transaction from the monitor to inspect the model&rsquo;s reasoning.
          </div>
        ) : loading ? (
          <div className="empty-state">
            <span className="material-symbols-outlined">hourglass_top</span>
            Computing SHAP attributions…
          </div>
        ) : ranked.length === 0 ? (
          <div className="empty-state">
            <span className="material-symbols-outlined">data_alert</span>
            No SHAP attributions available for this transaction.
          </div>
        ) : (
          <>
            <div className="explain-summary">
              <div className="explain-stat">
                <span className="explain-stat-label">Transaction</span>
                <span className="explain-stat-value mono">{transaction.transactionId ?? "—"}</span>
              </div>
              <div className="explain-stat">
                <span className="explain-stat-label">Fraud score</span>
                <span className="explain-stat-value mono">{formatPercent(score ?? 0)}</span>
              </div>
              <div className="explain-stat">
                <span className="explain-stat-label">Amount</span>
                <span className="explain-stat-value mono">{formatAmount(transaction.amount)}</span>
              </div>
            </div>

            <div className="shap-panel">
              <div className="shap-panel-head">
                <span className="shap-panel-title">Top drivers</span>
              </div>

              <div className="shap-axis-labels">
                <span className="shap-axis-gutter" aria-hidden="true" />
                <div className="shap-axis-track-labels">
                  <span>Lowers risk</span>
                  <span>Raises risk</span>
                </div>
                <span className="shap-axis-gutter" aria-hidden="true" />
              </div>

              <div className="shap-diverge" role="img" aria-label="SHAP feature contributions">
                {ranked.map((f) => {
                  const widthPct = (Math.abs(f.shap_value) / maxAbs) * 50;
                  const isPositive = f.shap_value >= 0;

                  return (
                    <div className="shap-row" key={f.feature}>
                      <span className="shap-row-label" title={f.feature}>
                        {expanded ? f.feature : shortLabel(f.feature)}
                      </span>
                      <div className="shap-row-track">
                        <div
                          className={`shap-bar ${isPositive ? "shap-bar-pos" : "shap-bar-neg"}`}
                          style={{
                            width: `${widthPct}%`,
                            ...(isPositive ? { left: "50%" } : { right: "50%" }),
                          }}
                        />
                      </div>
                      <span className="shap-row-value mono">
                        {isPositive ? "+" : ""}
                        {f.shap_value.toFixed(3)}
                      </span>
                    </div>
                  );
                })}
              </div>

              {explain?.decision && (
                <div className="explain-decision">
                  Model decision · <span className="mono">{explain.decision}</span>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
