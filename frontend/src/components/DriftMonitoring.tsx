import Plot from "react-plotly.js";
import type { FeatureDriftData } from "../types";
import { axisStyle, basePlotLayout } from "../plotlyTheme";

type Props = {
  drift: FeatureDriftData | null;
  loading: boolean;
  expanded?: boolean;
};

const CHART_HEIGHT_COMPACT = 320;
const CHART_HEIGHT_EXPANDED = 420;
const BAR_COLOR = "rgba(13, 13, 13, 0.55)";

export function DriftMonitoring({ drift, loading, expanded = false }: Props) {
  const chartHeight = expanded ? CHART_HEIGHT_EXPANDED : CHART_HEIGHT_COMPACT;
  const features = drift?.features ?? [];
  const hasHighDrift = (drift?.high_drift_count ?? 0) > 0;
  const showInitialLoading = loading && features.length === 0;

  return (
    <section className={`panel ${expanded ? "panel-expanded" : ""}`}>
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Feature Drift Monitoring</h2>
          <p className="panel-subtitle">Streaming distribution vs IEEE-CIS training reference</p>
        </div>
        {loading && features.length > 0 && (
          <span className="drift-refreshing" aria-live="polite">
            Updating…
          </span>
        )}
      </div>

      <div className="panel-body">
        {showInitialLoading ? (
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
              <div className="alert alert-info" role="alert">
                <strong>High drift detected</strong> on {drift?.high_drift_count} feature
                {drift?.high_drift_count === 1 ? "" : "s"}. Model reliability may degrade — review
                incoming transaction patterns.
              </div>
            )}

            <div className="chart-body chart-body-compact drift-chart">
              <Plot
                data={[
                  {
                    type: "bar",
                    x: features.map((f) => f.drift_score),
                    y: features.map((f) => f.feature),
                    orientation: "h",
                    marker: { color: BAR_COLOR },
                    hovertemplate:
                      "%{y}<br>Drift: %{x:.3f}<br>Status: %{customdata[0]}<br>Batch μ: %{customdata[1]}<br>Train μ: %{customdata[2]}<extra></extra>",
                    customdata: features.map((f) => [f.status, f.batch_mean, f.training_mean]),
                  },
                ]}
                layout={{
                  ...basePlotLayout,
                  height: chartHeight,
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
                style={{ width: "100%", height: chartHeight }}
                useResizeHandler
              />
            </div>

            <div className="table-scroll drift-table">
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
                        <span className="drift-badge">{f.status}</span>
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
