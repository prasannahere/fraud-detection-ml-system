import Plot from "react-plotly.js";
import type { FeatureDriftData } from "../types";
import { axisStyle, basePlotLayout, plotColors } from "../plotlyTheme";

type Props = {
  drift: FeatureDriftData | null;
  loading: boolean;
};

function statusClass(status: string) {
  if (status === "High Drift") return "drift-high";
  if (status === "Moderate Drift") return "drift-moderate";
  return "drift-stable";
}

function barColor(status: string) {
  if (status === "High Drift") return plotColors.danger;
  if (status === "Moderate Drift") return plotColors.warning;
  return plotColors.success;
}

export function DriftMonitoring({ drift, loading }: Props) {
  const features = drift?.features ?? [];
  const hasHighDrift = (drift?.high_drift_count ?? 0) > 0;

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Feature Drift Monitoring</h2>
          <p className="panel-subtitle">Streaming distribution vs IEEE-CIS training reference</p>
        </div>
      </div>

      <div className="panel-body">
        {loading ? (
          <div className="empty-state">Computing feature drift across recent transactions…</div>
        ) : drift?.message ? (
          <div className="empty-state">{drift.message}</div>
        ) : features.length === 0 ? (
          <div className="empty-state">
            Score at least one batch of transactions to populate drift monitoring.
          </div>
        ) : (
          <>
            {hasHighDrift && (
              <div className="alert alert-warning" role="alert">
                <strong>High drift detected</strong> on {drift?.high_drift_count} feature
                {drift?.high_drift_count === 1 ? "" : "s"}. Model reliability may degrade — review
                incoming transaction patterns.
              </div>
            )}

            <div className="chart-body chart-body-compact">
              <Plot
                data={[
                  {
                    type: "bar",
                    x: features.map((f) => f.drift_score),
                    y: features.map((f) => f.feature),
                    orientation: "h",
                    marker: { color: features.map((f) => barColor(f.status)) },
                    hovertemplate:
                      "%{y}<br>Drift: %{x:.3f}<br>Batch μ: %{customdata[0]}<br>Train μ: %{customdata[1]}<extra></extra>",
                    customdata: features.map((f) => [f.batch_mean, f.training_mean]),
                  },
                ]}
                layout={{
                  ...basePlotLayout,
                  height: Math.max(260, features.length * 36 + 80),
                  margin: { l: 130, r: 24, t: 16, b: 48 },
                  xaxis: {
                    title: { text: "Drift Score" },
                    range: [0, Math.max(0.35, ...features.map((f) => f.drift_score)) * 1.1],
                    ...axisStyle,
                  },
                  yaxis: { automargin: true, ...axisStyle },
                  showlegend: false,
                }}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: "100%" }}
                useResizeHandler
              />
            </div>

            <div className="table-scroll">
              <table className="data-table data-table-compact">
                <thead>
                  <tr>
                    <th>Feature</th>
                    <th>Drift Score</th>
                    <th>Status</th>
                    <th>Batch Mean</th>
                    <th>Training Mean</th>
                  </tr>
                </thead>
                <tbody>
                  {features.map((f) => (
                    <tr key={f.feature}>
                      <td className="mono">{f.feature}</td>
                      <td className="mono">{f.drift_score.toFixed(3)}</td>
                      <td>
                        <span className={`drift-badge ${statusClass(f.status)}`}>{f.status}</span>
                      </td>
                      <td className="mono">{f.batch_mean}</td>
                      <td className="mono">{f.training_mean}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
