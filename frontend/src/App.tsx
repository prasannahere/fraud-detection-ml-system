import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  driftMonitor,
  explain,
  fetchBatchSample,
  getToken,
  healthFraud,
  healthStream,
  login,
  predict,
  predictBatch,
  setToken,
  streamUrl,
} from "./api";
import { DriftMonitoring } from "./components/DriftMonitoring";
import { ExplainabilityPanel } from "./components/ExplainabilityPanel";
import { FraudTimeline } from "./components/FraudTimeline";
import { Header } from "./components/Header";
import { KpiCards } from "./components/KpiCards";
import { TransactionMonitor } from "./components/TransactionMonitor";
import type { ExplainData, FeatureDriftData, KpiMetrics, TransactionRecord } from "./types";
import {
  FRAUD_THRESHOLD,
  buildTransactionRecord,
  toTransaction,
} from "./utils/transaction";

type HealthState = "ok" | "degraded" | "offline" | "checking";

const MAX_TRANSACTIONS = 500;
const DRIFT_BATCH_SIZE = 50;

export default function App() {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [signedIn, setSignedIn] = useState(!!getToken());
  const [error, setError] = useState("");
  const [fraudHealth, setFraudHealth] = useState<HealthState>("checking");
  const [streamHealth, setStreamHealth] = useState<HealthState>("checking");
  const [threshold] = useState(FRAUD_THRESHOLD);

  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [explainData, setExplainData] = useState<ExplainData | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const [driftData, setDriftData] = useState<FeatureDriftData | null>(null);
  const [driftLoading, setDriftLoading] = useState(false);

  const [streaming, setStreaming] = useState(false);
  const [scoreStream, setScoreStream] = useState(true);
  const [batchLoading, setBatchLoading] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const selectedTx = useMemo(
    () => transactions.find((t) => t.id === selectedId) ?? null,
    [transactions, selectedId]
  );

  const metrics: KpiMetrics = useMemo(() => {
    const total = transactions.length;
    const fraudDetected = transactions.filter((t) => t.prediction === "Fraud").length;
    const avgRiskScore = total
      ? transactions.reduce((sum, t) => sum + t.fraudScore, 0) / total
      : 0;
    return {
      total,
      fraudDetected,
      fraudRate: total ? fraudDetected / total : 0,
      avgRiskScore,
    };
  }, [transactions]);

  const refreshHealth = useCallback(async () => {
    try {
      const fh = await healthFraud();
      setFraudHealth(fh.status === "ok" ? "ok" : "degraded");
    } catch {
      setFraudHealth("offline");
    }
    try {
      await healthStream();
      setStreamHealth("ok");
    } catch {
      setStreamHealth("offline");
    }
  }, []);

  const refreshDrift = useCallback(
    async (batch: TransactionRecord[]) => {
      if (!signedIn || batch.length === 0) return;
      setDriftLoading(true);
      try {
        const payload = batch.slice(0, DRIFT_BATCH_SIZE).map((t) => toTransaction(t.raw));
        const { data } = await driftMonitor(payload);
        setDriftData(data);
      } catch {
        /* drift is best-effort */
      } finally {
        setDriftLoading(false);
      }
    },
    [signedIn]
  );

  const addTransaction = useCallback((record: TransactionRecord) => {
    setTransactions((prev) => {
      const next = [record, ...prev].slice(0, MAX_TRANSACTIONS);
      return next;
    });
  }, []);

  const loadExplain = useCallback(
    async (tx: TransactionRecord) => {
      if (!signedIn) return;
      setExplainLoading(true);
      setExplainData(null);
      try {
        const { data } = await explain(toTransaction(tx.raw), threshold);
        setExplainData(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Explainability request failed");
      } finally {
        setExplainLoading(false);
      }
    },
    [signedIn, threshold]
  );

  const handleSelect = useCallback(
    (tx: TransactionRecord) => {
      setSelectedId(tx.id);
      loadExplain(tx);
    },
    [loadExplain]
  );

  const scoreRow = useCallback(
    async (row: Record<string, unknown>) => {
      if (!signedIn || !scoreStream) return null;
      try {
        const tx = toTransaction(row);
        if (!tx.TransactionDT || !tx.TransactionAmt) return null;
        const { data } = await predict(tx, threshold);
        return buildTransactionRecord(row, data.fraud_probability, "stream", threshold);
      } catch {
        return null;
      }
    },
    [signedIn, scoreStream, threshold]
  );

  useEffect(() => {
    refreshHealth();
    const id = setInterval(refreshHealth, 20000);
    return () => clearInterval(id);
  }, [refreshHealth]);

  useEffect(() => {
    if (transactions.length === 0 || !signedIn) return;
    const timer = window.setTimeout(() => {
      refreshDrift(transactions);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [transactions, signedIn, refreshDrift]);

  const handleLogin = async () => {
    setError("");
    try {
      await login(username, password);
      setSignedIn(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    }
  };

  const handleLogout = () => {
    setToken("");
    setSignedIn(false);
    stopStream();
    setExplainData(null);
    setDriftData(null);
  };

  const stopStream = () => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setStreaming(false);
  };

  const loadBatch = async () => {
    if (!signedIn) return;
    setError("");
    setBatchLoading(true);
    try {
      const { transactions: rows } = await fetchBatchSample(40);
      const payload = rows.map((row) => toTransaction(row));
      const { data } = await predictBatch(payload, threshold);
      const baseTs = Date.now();
      const scored = data.predictions.map((pred, idx) => {
        const raw = rows[pred.index ?? idx] ?? rows[idx];
        const record = buildTransactionRecord(raw, pred.fraud_probability, "batch", threshold);
        return {
          ...record,
          timestamp: baseTs - idx * 1000,
          timestampLabel: new Date(baseTs - idx * 1000).toLocaleString(),
        };
      });
      setTransactions((prev) => [...scored, ...prev].slice(0, MAX_TRANSACTIONS));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Batch load failed");
    } finally {
      setBatchLoading(false);
    }
  };

  const startStream = () => {
    stopStream();
    setStreaming(true);
    const es = new EventSource(streamUrl());
    eventSourceRef.current = es;

    es.onmessage = async (event) => {
      try {
        const row = JSON.parse(event.data) as Record<string, unknown>;
        if (!scoreStream || !signedIn) return;
        const scored = await scoreRow(row);
        if (scored) addTransaction(scored);
      } catch {
        /* ignore malformed events */
      }
    };

    es.onerror = () => {
      setError("Stream connection lost. Verify stream-service is running on port 8001.");
      stopStream();
    };
  };

  return (
    <div className="app">
      <Header
        fraudHealth={fraudHealth}
        streamHealth={streamHealth}
        signedIn={signedIn}
        username={username}
        password={password}
        streaming={streaming}
        scoreStream={scoreStream}
        onUsernameChange={setUsername}
        onPasswordChange={setPassword}
        onLogin={handleLogin}
        onLogout={handleLogout}
        onStartStream={startStream}
        onStopStream={stopStream}
        onLoadBatch={loadBatch}
        batchLoading={batchLoading}
        onScoreStreamChange={setScoreStream}
      />

      <main className="main">
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}

        {!signedIn && (
          <div className="alert alert-info">
            Sign in to score transactions with the XGBoost model and view SHAP explanations.
          </div>
        )}

        <KpiCards metrics={metrics} />
        <FraudTimeline transactions={transactions} threshold={threshold} />

        <div className="split-grid">
          <TransactionMonitor
            transactions={transactions}
            selectedId={selectedId}
            onSelect={handleSelect}
          />
          <ExplainabilityPanel
            transaction={selectedTx}
            explain={explainData}
            loading={explainLoading}
          />
        </div>

        <DriftMonitoring drift={driftData} loading={driftLoading} />
      </main>
    </div>
  );
}
