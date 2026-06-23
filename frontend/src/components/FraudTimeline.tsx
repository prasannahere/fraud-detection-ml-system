import Plot from "react-plotly.js";
import type { TransactionRecord } from "../types";
import { formatAmount, formatPercent, formatTimeShort } from "../utils/format";
import { FRAUD_THRESHOLD } from "../utils/transaction";
import { axisStyle, basePlotLayout, plotColors } from "../plotlyTheme";

type Props = {
  transactions: TransactionRecord[];
  threshold?: number;
};

export function FraudTimeline({ transactions, threshold = FRAUD_THRESHOLD }: Props) {
  const normal = transactions.filter((t) => t.prediction === "Normal");
  const fraud = transactions.filter((t) => t.prediction === "Fraud");

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Fraud Score Timeline</h2>
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

      <div className="panel-body chart-body">
        {transactions.length === 0 ? (
          <div className="empty-state">Start the live stream or score transactions to populate the timeline.</div>
        ) : (
          <Plot
            data={[
              {
                type: "scatter",
                mode: "markers",
                name: "Normal",
                x: normal.map((t) => new Date(t.timestamp)),
                y: normal.map((t) => t.fraudScore),
                marker: { color: plotColors.success, size: 8, opacity: 0.75, line: { width: 0 } },
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
                  color: plotColors.danger,
                  size: 12,
                  symbol: "diamond",
                  line: { color: "#fca5a5", width: 1 },
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
              height: 320,
              xaxis: { title: { text: "Transaction Timestamp" }, ...axisStyle, type: "date" },
              yaxis: {
                title: { text: "Fraud Probability" },
                range: [0, 1],
                tickformat: ".0%",
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
                  line: { color: plotColors.warning, width: 1.5, dash: "dash" },
                },
              ],
              showlegend: false,
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: "100%", height: "100%" }}
            useResizeHandler
          />
        )}
      </div>
    </section>
  );
}
