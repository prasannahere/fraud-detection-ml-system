import Plot from "react-plotly.js";
import type { ExplainData } from "../types";
import type { TransactionRecord } from "../types";
import { formatPercent } from "../utils/format";
import { axisStyle, basePlotLayout, plotColors } from "../plotlyTheme";

type Props = {
  transaction: TransactionRecord | null;
  explain: ExplainData | null;
  loading: boolean;
};

export function ExplainabilityPanel({ transaction, explain, loading }: Props) {
  const positive = explain?.positive_contributors ?? [];
  const negative = explain?.negative_contributors ?? [];
  const waterfallFeatures = [...positive, ...negative].sort(
    (a, b) => Math.abs(b.shap_value) - Math.abs(a.shap_value)
  );

  return (
    <section className="panel panel-fill">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Explainability Panel</h2>
          <p className="panel-subtitle">SHAP feature attribution — XGBoost IEEE-CIS model</p>
        </div>
      </div>

      <div className="panel-body explain-body">
        {!transaction ? (
          <div className="empty-state">Select a transaction from the monitor to inspect model reasoning.</div>
        ) : loading ? (
          <div className="empty-state">Computing SHAP attributions…</div>
        ) : (
          <>
            <div className="explain-summary">
              <div className="explain-stat">
                <span className="explain-stat-label">Transaction ID</span>
                <span className="explain-stat-value mono">{transaction.transactionId ?? "—"}</span>
              </div>
              <div className="explain-stat">
                <span className="explain-stat-label">Fraud Score</span>
                <span className="explain-stat-value mono danger-text">
                  {formatPercent(explain?.fraud_probability ?? transaction.fraudScore)}
                </span>
              </div>
              <div className="explain-stat">
                <span className="explain-stat-label">Prediction</span>
                <span
                  className={`pill ${
                    transaction.prediction === "Fraud" ? "pill-danger" : "pill-safe"
                  }`}
                >
                  {transaction.prediction}
                </span>
              </div>
            </div>

            {waterfallFeatures.length > 0 && (
              <div className="chart-mini">
                <Plot
                  data={[
                    {
                      type: "bar",
                      orientation: "h",
                      y: waterfallFeatures.map((f) => f.feature),
                      x: waterfallFeatures.map((f) => f.shap_value),
                      marker: {
                        color: waterfallFeatures.map((f) =>
                          f.shap_value >= 0 ? plotColors.danger : plotColors.success
                        ),
                      },
                      hovertemplate: "%{y}: %{x:+.4f}<extra></extra>",
                    },
                  ]}
                  layout={{
                    ...basePlotLayout,
                    height: Math.max(220, waterfallFeatures.length * 28 + 60),
                    margin: { l: 140, r: 16, t: 8, b: 32 },
                    xaxis: { title: { text: "SHAP contribution" }, zeroline: true, ...axisStyle },
                    yaxis: { automargin: true, ...axisStyle },
                    showlegend: false,
                  }}
                  config={{ displayModeBar: false, responsive: true }}
                  style={{ width: "100%" }}
                  useResizeHandler
                />
              </div>
            )}

            <div className="contrib-grid">
              <div className="contrib-col">
                <h3 className="contrib-title positive">Positive contributors</h3>
                <ul className="contrib-list">
                  {positive.length === 0 ? (
                    <li className="contrib-empty">None</li>
                  ) : (
                    positive.map((f) => (
                      <li key={f.feature} className="contrib-item">
                        <span className="contrib-feature">{f.feature}</span>
                        <span className="contrib-value positive">+{f.shap_value.toFixed(4)}</span>
                      </li>
                    ))
                  )}
                </ul>
              </div>
              <div className="contrib-col">
                <h3 className="contrib-title negative">Negative contributors</h3>
                <ul className="contrib-list">
                  {negative.length === 0 ? (
                    <li className="contrib-empty">None</li>
                  ) : (
                    negative.map((f) => (
                      <li key={f.feature} className="contrib-item">
                        <span className="contrib-feature">{f.feature}</span>
                        <span className="contrib-value negative">{f.shap_value.toFixed(4)}</span>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
