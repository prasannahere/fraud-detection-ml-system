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
const STREAM_RECONNECT_BASE_MS = 1000;
const STREAM_RECONNECT_MAX_MS = 30000;

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
  const streamStopRequestedRef = useRef(false);
  const streamReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamReconnectAttemptRef = useRef(0);
  const signedInRef = useRef(signedIn);
  signedInRef.current = signedIn;

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
    const [fraudResult, streamResult] = await Promise.allSettled([healthFraud(), healthStream()]);

    if (fraudResult.status === "fulfilled") {
      setFraudHealth(fraudResult.value.status === "ok" ? "ok" : "degraded");
    } else {
      setFraudHealth("offline");
    }

    if (streamResult.status === "fulfilled") {
      setStreamHealth("ok");
    } else {
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
      if (!signedInRef.current) return null;
      try {
        const tx = toTransaction(row);
        if (tx.TransactionDT == null || tx.TransactionAmt == null) return null;
        const { data } = await predict(tx, threshold);
        return buildTransactionRecord(row, data.fraud_probability, "stream", threshold);
      } catch {
        return null;
      }
    },
    [threshold]
  );

  const handleStreamMessage = useCallback(
    async (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as Record<string, unknown>;
        if (!signedInRef.current) return;

        if (payload.scored === true && payload.transaction && payload.fraud_probability != null) {
          const record = buildTransactionRecord(
            payload.transaction as Record<string, unknown>,
            payload.fraud_probability as number,
            "stream",
            threshold
          );
          addStreamTransaction(record);
          return;
        }

        const scored = await scoreRow(payload);
        if (scored) addStreamTransaction(scored);
      } catch {
        /* ignore malformed events */
      }
    },
    [addStreamTransaction, scoreRow, threshold]
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

  const stopStream = useCallback((userInitiated = true) => {
    if (userInitiated) {
      streamStopRequestedRef.current = true;
    }
    if (streamReconnectTimerRef.current) {
      clearTimeout(streamReconnectTimerRef.current);
      streamReconnectTimerRef.current = null;
    }
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    if (userInitiated) {
      setStreaming(false);
    }
  }, []);

  const connectStream = useCallback(() => {
    const es = new EventSource(streamUrl());
    eventSourceRef.current = es;

    es.onopen = () => {
      streamReconnectAttemptRef.current = 0;
      setError((prev) => (prev.startsWith("Stream reconnecting") ? "" : prev));
    };

    es.onmessage = (event) => {
      void handleStreamMessage(event);
    };

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;

      if (streamStopRequestedRef.current) return;

      const attempt = streamReconnectAttemptRef.current;
      streamReconnectAttemptRef.current += 1;
      const delay = Math.min(STREAM_RECONNECT_BASE_MS * 2 ** attempt, STREAM_RECONNECT_MAX_MS);

      setError(`Stream reconnecting in ${Math.round(delay / 1000)}s…`);

      streamReconnectTimerRef.current = setTimeout(() => {
        if (!streamStopRequestedRef.current) {
          connectStream();
        }
      }, delay);
    };
  }, [handleStreamMessage]);

  const startStream = useCallback(() => {
    stopStream(true);
    streamStopRequestedRef.current = false;
    streamReconnectAttemptRef.current = 0;
    setStreaming(true);
    connectStream();
  }, [connectStream, stopStream]);

  useEffect(() => {
    return () => stopStream(true);
  }, [stopStream]);

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
          onStopStream={() => stopStream(true)}
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
