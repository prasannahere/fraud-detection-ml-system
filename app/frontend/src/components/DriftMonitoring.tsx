import Plot from "react-plotly.js";
import type { FeatureDriftData } from "../types";
import { axisStyle, basePlotLayout } from "../plotlyTheme";

type Props = {
  drift: FeatureDriftData | null;
  loading: boolean;
  expanded?: boolean;
};

const CHART_HEIGHT_COMPACT = 320;
const BAR_COLOR = "rgba(26, 115, 232, 0.75)";
const BAR_ROW_HEIGHT = 44;

function chartHeightForFeatures(count: number, expanded: boolean) {
  if (count === 0) return expanded ? 420 : CHART_HEIGHT_COMPACT;
  const padding = expanded ? 96 : 72;
  const minHeight = expanded ? 420 : CHART_HEIGHT_COMPACT;
  return Math.max(minHeight, count * BAR_ROW_HEIGHT + padding);
}

export function DriftMonitoring({ drift, loading, expanded = false }: Props) {
  const features = drift?.features ?? [];
  const chartHeight = chartHeightForFeatures(features.length, expanded);
  const hasHighDrift = (drift?.high_drift_count ?? 0) > 0;
  const showInitialLoading = loading && features.length === 0;

  return (
    <section className={`panel panel-drift ${expanded ? "panel-expanded" : ""}`}>
      <div className="panel-header">
        <div>
          <h2 className="panel-title">
            <span className="material-symbols-outlined">monitoring</span>
            Feature Drift Monitoring
          </h2>
          <p className="panel-subtitle">Streaming distribution vs IEEE-CIS training reference</p>
        </div>
        {loading && features.length > 0 && (
          <span className="drift-refreshing" aria-live="polite">
            Updating…
          </span>
        )}
      </div>

      <div className={`panel-body ${expanded ? "drift-body-expanded" : ""}`}>
        {showInitialLoading ? (
          <div className="empty-state">Computing feature drift across recent transactions…</div>
        ) : drift?.message ? (
          <div className="empty-state">{drift.message}</div>
        ) : features.length === 0 ? (
          <div className="empty-state">
            Drift updates after every 40 scored transactions (live stream or load batch).
          </div>
        ) : (
          <>
            {hasHighDrift && (
              <div className="alert alert-info" role="alert">
                <span className="material-symbols-outlined">info</span>
                <span>
                  <strong>High drift detected</strong> on {drift?.high_drift_count} feature
                  {drift?.high_drift_count === 1 ? "" : "s"}. Model reliability may degrade — review
                  incoming transaction patterns.
                </span>
              </div>
            )}

            <div
              className={`chart-body chart-body-compact drift-chart ${expanded ? "drift-chart-expanded" : ""}`}
              style={{ height: chartHeight }}
            >
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

            <div className={`table-scroll drift-table ${expanded ? "drift-table-expanded" : ""}`}>
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
