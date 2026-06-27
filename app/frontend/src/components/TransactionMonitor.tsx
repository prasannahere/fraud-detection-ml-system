import { useMemo, useState } from "react";
import type { PredictionFilter, SortDir, SortKey, TransactionRecord } from "../types";
import { formatAmount, formatPercent } from "../utils/format";

type Props = {
  transactions: TransactionRecord[];
  selectedId: string | null;
  onSelect: (tx: TransactionRecord) => void;
  expanded?: boolean;
};

function compare(a: TransactionRecord, b: TransactionRecord, key: SortKey, dir: SortDir) {
  const mul = dir === "asc" ? 1 : -1;
  switch (key) {
    case "transactionId":
      return mul * ((a.transactionId ?? 0) - (b.transactionId ?? 0));
    case "timestamp":
      return mul * (a.timestamp - b.timestamp);
    case "amount":
      return mul * ((a.amount ?? 0) - (b.amount ?? 0));
    case "fraudScore":
      return mul * (a.fraudScore - b.fraudScore);
    case "prediction":
      return mul * a.prediction.localeCompare(b.prediction);
    default:
      return 0;
  }
}

export function TransactionMonitor({ transactions, selectedId, onSelect, expanded = false }: Props) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<PredictionFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("timestamp");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return transactions
      .filter((t) => {
        if (filter === "fraud" && t.prediction !== "Fraud") return false;
        if (filter === "normal" && t.prediction !== "Normal") return false;
        if (!q) return true;
        const id = String(t.transactionId ?? "");
        const amt = String(t.amount ?? "");
        return id.includes(q) || amt.includes(q) || t.prediction.toLowerCase().includes(q);
      })
      .sort((a, b) => compare(a, b, sortKey, sortDir));
  }, [transactions, search, filter, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sortIndicator = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "");

  return (
    <section className={`panel panel-fill ${expanded ? "panel-expanded" : ""}`}>
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Live Transaction Monitor</h2>
          <p className="panel-subtitle">Analyst queue — click a row for SHAP explainability</p>
        </div>
      </div>

      <div className="table-toolbar">
        <input
          className="search-input"
          placeholder="Search by ID, amount, prediction…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search transactions"
        />
        <div className="filter-group" role="group" aria-label="Filter by prediction">
          {(["all", "fraud", "normal"] as PredictionFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={`filter-btn ${filter === f ? "active" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : f === "fraud" ? "Fraud" : "Normal"}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-body panel-body-flush table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>
                <button type="button" className="th-btn" onClick={() => toggleSort("transactionId")}>
                  Transaction ID{sortIndicator("transactionId")}
                </button>
              </th>
              <th>
                <button type="button" className="th-btn" onClick={() => toggleSort("timestamp")}>
                  Timestamp{sortIndicator("timestamp")}
                </button>
              </th>
              <th>
                <button type="button" className="th-btn" onClick={() => toggleSort("amount")}>
                  Amount{sortIndicator("amount")}
                </button>
              </th>
              <th>
                <button type="button" className="th-btn" onClick={() => toggleSort("fraudScore")}>
                  Fraud Score{sortIndicator("fraudScore")}
                </button>
              </th>
              <th>
                <button type="button" className="th-btn" onClick={() => toggleSort("prediction")}>
                  Prediction{sortIndicator("prediction")}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="table-empty">
                  No transactions match your filters.
                </td>
              </tr>
            ) : (
              filtered.map((t) => (
                <tr
                  key={t.id}
                  className={`table-row ${t.prediction === "Fraud" ? "row-fraud" : ""} ${
                    selectedId === t.id ? "row-selected" : ""
                  }`}
                  onClick={() => onSelect(t)}
                >
                  <td className="mono">{t.transactionId ?? "—"}</td>
                  <td className="mono">{t.timestampLabel}</td>
                  <td className="mono">{formatAmount(t.amount)}</td>
                  <td className="mono">{formatPercent(t.fraudScore)}</td>
                  <td>
                    <span className="pill pill-neutral">{t.prediction}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
