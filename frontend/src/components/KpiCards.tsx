import type { KpiMetrics } from "../types";
import { formatPercent } from "../utils/format";

type Props = { metrics: KpiMetrics };

const cards = [
  { key: "total" as const, label: "Total Transactions Processed", accent: false },
  { key: "fraudDetected" as const, label: "Fraud Transactions Detected", accent: true },
  { key: "fraudRate" as const, label: "Fraud Rate", accent: true, isPercent: true },
  { key: "avgRiskScore" as const, label: "Average Fraud Risk Score", accent: false, isPercent: true },
];

export function KpiCards({ metrics }: Props) {
  return (
    <section className="kpi-grid" aria-label="Key performance indicators">
      {cards.map((card) => {
        const raw = metrics[card.key];
        const value = card.isPercent ? formatPercent(raw) : raw.toLocaleString();

        return (
          <article key={card.key} className={`kpi-card ${card.accent ? "kpi-card-accent" : ""}`}>
            <p className="kpi-card-label">{card.label}</p>
            <p className={`kpi-card-value ${card.accent && raw > 0 ? "danger" : ""}`}>{value}</p>
          </article>
        );
      })}
    </section>
  );
}
