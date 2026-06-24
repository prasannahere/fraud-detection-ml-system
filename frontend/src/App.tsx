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
import { ExpandablePanel } from "./components/ExpandablePanel";
import { FraudTimeline } from "./components/FraudTimeline";
import { Header } from "./components/Header";
import { KpiCards } from "./components/KpiCards";
import { LoginOverlay } from "./components/LoginOverlay";
import { PanelOverlay } from "./components/PanelOverlay";
import { TransactionMonitor } from "./components/TransactionMonitor";
import type { DashboardPanelId, ExplainData, FeatureDriftData, KpiMetrics, TransactionRecord } from "./types";
import {
  FRAUD_THRESHOLD,
  buildTransactionRecord,
  toTransaction,
} from "./utils/transaction";

type HealthState = "ok" | "degraded" | "offline" | "checking";

const MAX_TRANSACTIONS = 500;
const DRIFT_TRIGGER_SIZE = 40;
const DRIFT_BATCH_SIZE = 40;

export default function App() {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [signedIn, setSignedIn] = useState(!!getToken());
  const [error, setError] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [fraudHealth, setFraudHealth] = useState<HealthState>("checking");
  const [streamHealth, setStreamHealth] = useState<HealthState>("checking");
  const [threshold] = useState(FRAUD_THRESHOLD);

  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const transactionsRef = useRef<TransactionRecord[]>([]);
  transactionsRef.current = transactions;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [explainData, setExplainData] = useState<ExplainData | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const [driftData, setDriftData] = useState<FeatureDriftData | null>(null);
  const [driftLoading, setDriftLoading] = useState(false);
  const driftInFlightRef = useRef(false);
  const hasDriftDataRef = useRef(false);
  const [streaming, setStreaming] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [expandedPanel, setExpandedPanel] = useState<DashboardPanelId | null>(null);

  const streamDriftCounterRef = useRef(0);
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
      if (!signedIn || batch.length === 0 || driftInFlightRef.current) return;
      driftInFlightRef.current = true;
      // Only show the full loading state on first load — keep chart visible during refresh.
      if (!hasDriftDataRef.current) setDriftLoading(true);
      try {
        const payload = batch.slice(0, DRIFT_BATCH_SIZE).map((t) => toTransaction(t.raw));
        const { data } = await driftMonitor(payload);
        setDriftData(data);
        hasDriftDataRef.current = true;
      } catch {
        /* drift is best-effort */
      } finally {
        driftInFlightRef.current = false;
        setDriftLoading(false);
      }
    },
    [signedIn]
  );

  const addStreamTransaction = useCallback(
    (record: TransactionRecord) => {
      const next = [record, ...transactionsRef.current].slice(0, MAX_TRANSACTIONS);
      transactionsRef.current = next;
      setTransactions(next);

      streamDriftCounterRef.current += 1;
      if (streamDriftCounterRef.current < DRIFT_TRIGGER_SIZE) return;
      streamDriftCounterRef.current = 0;
      void refreshDrift(next.slice(0, DRIFT_BATCH_SIZE));
    },
    [refreshDrift]
  );

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
      if (!signedIn) return null;
      try {
        const tx = toTransaction(row);
        if (tx.TransactionDT == null || tx.TransactionAmt == null) return null;
        const { data } = await predict(tx, threshold);
        return buildTransactionRecord(row, data.fraud_probability, "stream", threshold);
      } catch {
        return null;
      }
    },
    [signedIn, threshold]
  );

  useEffect(() => {
    refreshHealth();
    const id = setInterval(refreshHealth, 20000);
    return () => clearInterval(id);
  }, [refreshHealth]);

  const handleLogin = async () => {
    setLoginError("");
    setLoginLoading(true);
    try {
      await login(username, password);
      setSignedIn(true);
    } catch (e) {
      setLoginError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    setToken("");
    setSignedIn(false);
    setLoginError("");
    stopStream();
    setExplainData(null);
    setDriftData(null);
    hasDriftDataRef.current = false;
    streamDriftCounterRef.current = 0;
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
      setTransactions((prev) => {
        const merged = [...scored, ...prev].slice(0, MAX_TRANSACTIONS);
        transactionsRef.current = merged;
        return merged;
      });
      streamDriftCounterRef.current = 0;
      void refreshDrift(scored);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Batch load failed");
    } finally {
      setBatchLoading(false);
    }
  };

  const renderDashboardPanel = (id: DashboardPanelId, expanded: boolean) => {
    switch (id) {
      case "timeline":
        return <FraudTimeline transactions={transactions} threshold={threshold} expanded={expanded} />;
      case "monitor":
        return (
          <TransactionMonitor
            transactions={transactions}
            selectedId={selectedId}
            onSelect={handleSelect}
            expanded={expanded}
          />
        );
      case "explain":
        return (
          <ExplainabilityPanel
            transaction={selectedTx}
            explain={explainData}
            loading={explainLoading}
            expanded={expanded}
          />
        );
      case "drift":
        return <DriftMonitoring drift={driftData} loading={driftLoading} expanded={expanded} />;
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
        if (!signedIn) return;
        const scored = await scoreRow(row);
        if (scored) addStreamTransaction(scored);
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
      <div className={signedIn ? "dashboard-shell" : "dashboard-shell dashboard-shell--locked"}>
        <Header
          fraudHealth={fraudHealth}
          streamHealth={streamHealth}
          signedIn={signedIn}
          username={username}
          streaming={streaming}
          onLogout={handleLogout}
          onStartStream={startStream}
          onStopStream={stopStream}
          onLoadBatch={loadBatch}
          batchLoading={batchLoading}
        />

        <main className="main">
          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}

          <KpiCards metrics={metrics} />

          <ExpandablePanel onExpand={() => signedIn && setExpandedPanel("timeline")}>
            {renderDashboardPanel("timeline", false)}
          </ExpandablePanel>

          <div className="split-grid">
            <ExpandablePanel onExpand={() => signedIn && setExpandedPanel("monitor")}>
              {renderDashboardPanel("monitor", false)}
            </ExpandablePanel>
            <ExpandablePanel onExpand={() => signedIn && setExpandedPanel("explain")}>
              {renderDashboardPanel("explain", false)}
            </ExpandablePanel>
          </div>

          <ExpandablePanel onExpand={() => signedIn && setExpandedPanel("drift")}>
            {renderDashboardPanel("drift", false)}
          </ExpandablePanel>
        </main>
      </div>

      {!signedIn && (
        <LoginOverlay
          username={username}
          password={password}
          error={loginError}
          loading={loginLoading}
          onUsernameChange={setUsername}
          onPasswordChange={setPassword}
          onLogin={handleLogin}
        />
      )}

      {expandedPanel && signedIn && (
        <PanelOverlay onClose={() => setExpandedPanel(null)}>
          {renderDashboardPanel(expandedPanel, true)}
        </PanelOverlay>
      )}
    </div>
  );
}
