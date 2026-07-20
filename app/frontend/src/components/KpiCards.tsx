import type { KpiMetrics } from "../types";
import { formatPercent } from "../utils/format";

type Props = { metrics: KpiMetrics };

const cards = [
  { key: "total" as const, label: "Total transactions", isPercent: false },
  { key: "fraudDetected" as const, label: "Fraud detected", isPercent: false },
  { key: "fraudRate" as const, label: "Fraud rate", isPercent: true },
  { key: "avgRiskScore" as const, label: "Avg. risk score", isPercent: true },
];

export function KpiCards({ metrics }: Props) {
  return (
    <section className="kpi-grid" aria-label="Key performance indicators">
      {cards.map((card) => {
        const raw = metrics[card.key];
        const value = card.isPercent ? formatPercent(raw) : raw.toLocaleString();

        return (
          <article key={card.key} className="kpi-card">
            <p className="kpi-card-label">{card.label}</p>
            <p className="kpi-card-value">{value}</p>
          </article>
        );
      })}
    </section>
  );
}
