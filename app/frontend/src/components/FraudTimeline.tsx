import { useMemo, useState } from "react";
import Plot from "react-plotly.js";
import type { TransactionRecord } from "../types";
import { formatAmount, formatPercent, formatTimeShort } from "../utils/format";
import { FRAUD_THRESHOLD } from "../utils/transaction";
import { axisStyle, basePlotLayout, plotColors } from "../plotlyTheme";

type Props = {
  transactions: TransactionRecord[];
  threshold?: number;
  expanded?: boolean;
};

type TimelineRange = "1m" | "5m" | "15m" | "30m" | "1h";

const TIME_RANGES: { id: TimelineRange; label: string; ms: number }[] = [
  { id: "1m", label: "1 min", ms: 60_000 },
  { id: "5m", label: "5 min", ms: 5 * 60_000 },
  { id: "15m", label: "15 min", ms: 15 * 60_000 },
  { id: "30m", label: "30 min", ms: 30 * 60_000 },
  { id: "1h", label: "1 hr", ms: 60 * 60_000 },
];

const CHART_HEIGHT_COMPACT = 360;
const CHART_HEIGHT_EXPANDED = 480;
const WINDOW_PAD_RATIO = 0.04;

function buildSeries(batch: TransactionRecord[]) {
  const normal = batch.filter((t) => t.prediction === "Normal");
  const fraud = batch.filter((t) => t.prediction === "Fraud");
  return { normal, fraud };
}

export function FraudTimeline({ transactions, threshold = FRAUD_THRESHOLD, expanded = false }: Props) {
  const chartHeight = expanded ? CHART_HEIGHT_EXPANDED : CHART_HEIGHT_COMPACT;
  const [rangeId, setRangeId] = useState<TimelineRange>("5m");

  const rangeMs = TIME_RANGES.find((r) => r.id === rangeId)?.ms ?? TIME_RANGES[1].ms;

  const { windowStart, windowEnd, inWindow, normal, fraud } = useMemo(() => {
    if (transactions.length === 0) {
      const now = Date.now();
      return {
        windowStart: now - rangeMs,
        windowEnd: now,
        inWindow: [] as TransactionRecord[],
        normal: [] as TransactionRecord[],
        fraud: [] as TransactionRecord[],
      };
    }

    const latest = Math.max(...transactions.map((t) => t.timestamp));
    const start = latest - rangeMs;
    const end = latest + rangeMs * WINDOW_PAD_RATIO;
    const visible = transactions.filter((t) => t.timestamp >= start && t.timestamp <= end);
    const series = buildSeries(visible);

    return {
      windowStart: start,
      windowEnd: end,
      inWindow: visible,
      normal: series.normal,
      fraud: series.fraud,
    };
  }, [transactions, rangeMs]);

  return (
    <section className={`panel ${expanded ? "panel-expanded" : ""}`}>
      <div className="panel-header">
        <div>
          <h2 className="panel-title">
            <span className="material-symbols-outlined">timeline</span>
            Fraud Score Timeline
          </h2>
          <p className="panel-subtitle">Real-time anomaly blips across scored transactions</p>
        </div>
        <div className="legend-row">
          <span className="legend-item">
            <span className="legend-dot normal" /> Normal
          </span>
          <span className="legend-item">
            <span className="legend-dot fraud" /> Fraud (&ge; {formatPercent(threshold, 0)})
          </span>
        </div>
      </div>

      <div className="timeline-toolbar">
        <span className="timeline-toolbar-label">Window</span>
        <div className="filter-group" role="group" aria-label="Timeline window">
          {TIME_RANGES.map((range) => (
            <button
              key={range.id}
              type="button"
              className={`filter-btn ${rangeId === range.id ? "active" : ""}`}
              onClick={() => setRangeId(range.id)}
            >
              {range.label}
            </button>
          ))}
        </div>
        {transactions.length > 0 && (
          <span className="timeline-toolbar-meta">
            {inWindow.length} of {transactions.length} in view
          </span>
        )}
      </div>

      <div
        className="panel-body chart-body timeline-chart"
        style={expanded ? { minHeight: chartHeight, height: chartHeight } : undefined}
      >
        {transactions.length === 0 ? (
          <div className="empty-state">
            <span className="material-symbols-outlined">show_chart</span>
            Start the live stream or score transactions to populate the timeline.
          </div>
        ) : (
          <Plot
            data={[
              {
                type: "scatter",
                mode: "markers",
                name: "Normal",
                x: normal.map((t) => new Date(t.timestamp)),
                y: normal.map((t) => t.fraudScore),
                marker: { color: "rgba(26, 115, 232, 0.55)", size: 8, opacity: 0.85, line: { width: 0 } },
                hovertemplate:
                  "<b>Txn %{customdata[0]}</b><br>Amount: %{customdata[1]}<br>Score: %{y:.1%}<br>Time: %{customdata[2]}<br>Prediction: Normal<extra></extra>",
                customdata: normal.map((t) => [
                  t.transactionId ?? "—",
                  formatAmount(t.amount),
                  formatTimeShort(t.timestamp),
                ]),
              },
              {
                type: "scatter",
                mode: "markers",
                name: "Fraud",
                x: fraud.map((t) => new Date(t.timestamp)),
                y: fraud.map((t) => t.fraudScore),
                marker: {
                  color: "rgba(217, 48, 37, 0.9)",
                  size: 10,
                  symbol: "diamond",
                  line: { color: "rgba(217, 48, 37, 0.25)", width: 1 },
                },
                hovertemplate:
                  "<b>Txn %{customdata[0]}</b><br>Amount: %{customdata[1]}<br>Score: %{y:.1%}<br>Time: %{customdata[2]}<br>Prediction: Fraud<extra></extra>",
                customdata: fraud.map((t) => [
                  t.transactionId ?? "—",
                  formatAmount(t.amount),
                  formatTimeShort(t.timestamp),
                ]),
              },
            ]}
            layout={{
              ...basePlotLayout,
              height: chartHeight,
              margin: { l: 56, r: 20, t: 10, b: 44 },
              hovermode: "closest",
              xaxis: {
                ...axisStyle,
                type: "date",
                range: [new Date(windowStart), new Date(windowEnd)],
                tickformat: "%H:%M:%S",
                nticks: 7,
                tickfont: { size: 11 },
                fixedrange: true,
              },
              yaxis: {
                title: { text: "Fraud probability" },
                range: [0, 1],
                tickformat: ".0%",
                fixedrange: true,
                ...axisStyle,
              },
              shapes: [
                {
                  type: "line",
                  xref: "paper",
                  x0: 0,
                  x1: 1,
                  y0: threshold,
                  y1: threshold,
                  line: { color: "#80868b", width: 1.5, dash: "dash" },
                },
              ],
              annotations: [
                {
                  xref: "paper",
                  x: 0.995,
                  y: threshold,
                  xanchor: "right",
                  yanchor: "bottom",
                  text: `Threshold · ${formatPercent(threshold, 0)}`,
                  showarrow: false,
                  font: { size: 11, color: plotColors.muted },
                },
              ],
              showlegend: false,
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: "100%", height: chartHeight }}
            useResizeHandler
          />
        )}
      </div>
    </section>
  );
}
