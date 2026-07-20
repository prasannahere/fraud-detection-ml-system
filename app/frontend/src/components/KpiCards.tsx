import type { KpiMetrics } from "../types";
import { formatPercent } from "../utils/format";

type Props = { metrics: KpiMetrics };

const cards = [
  {
    key: "total" as const,
    label: "Total transactions",
    icon: "receipt_long",
    iconClass: "kpi-card-icon--blue",
    accent: false,
  },
  {
    key: "fraudDetected" as const,
    label: "Fraud detected",
    icon: "gpp_bad",
    iconClass: "kpi-card-icon--red",
    accent: true,
  },
  {
    key: "fraudRate" as const,
    label: "Fraud rate",
    icon: "percent",
    iconClass: "kpi-card-icon--yellow",
    accent: true,
    isPercent: true,
  },
  {
    key: "avgRiskScore" as const,
    label: "Avg. risk score",
    icon: "speed",
    iconClass: "kpi-card-icon--green",
    accent: false,
    isPercent: true,
  },
];

export function KpiCards({ metrics }: Props) {
  return (
    <section className="kpi-grid" aria-label="Key performance indicators">
      {cards.map((card) => {
        const raw = metrics[card.key];
        const value = card.isPercent ? formatPercent(raw) : raw.toLocaleString();

        return (
          <article key={card.key} className={`kpi-card ${card.accent ? "kpi-card-accent" : ""}`}>
            <div className={`kpi-card-icon ${card.iconClass}`} aria-hidden="true">
              <span className="material-symbols-outlined">{card.icon}</span>
            </div>
            <div className="kpi-card-body">
              <p className="kpi-card-label">{card.label}</p>
              <p className={`kpi-card-value ${card.accent && card.key === "fraudDetected" ? "danger" : ""}`}>
                {value}
              </p>
            </div>
          </article>
        );
      })}
    </section>
  );
}
