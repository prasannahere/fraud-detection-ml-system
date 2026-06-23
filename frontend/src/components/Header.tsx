type HealthState = "ok" | "degraded" | "offline" | "checking";

type Props = {
  fraudHealth: HealthState;
  streamHealth: HealthState;
  signedIn: boolean;
  username: string;
  streaming: boolean;
  scoreStream: boolean;
  onLogout: () => void;
  onStartStream: () => void;
  onStopStream: () => void;
  onLoadBatch: () => void;
  batchLoading: boolean;
  onScoreStreamChange: (v: boolean) => void;
};

function StatusDot({ state, label }: { state: HealthState; label: string }) {
  return (
    <div className="status-item">
      <span className={`status-dot ${state}`} />
      {label}
    </div>
  );
}

export function Header({
  fraudHealth,
  streamHealth,
  signedIn,
  username,
  streaming,
  scoreStream,
  onLogout,
  onStartStream,
  onStopStream,
  onLoadBatch,
  batchLoading,
  onScoreStreamChange,
}: Props) {
  return (
    <header className="header">
      <div className="header-brand">
        <div className="header-logo" aria-hidden="true">
          <svg viewBox="0 0 16 16" fill="none">
            <path
              d="M8 1.5L2 4.5v3.5c0 3.5 2.5 6 6 7.5 3.5-1.5 6-4 6-7.5V4.5L8 1.5z"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div>
          <div className="header-title">Sentinel</div>
          <div className="header-subtitle">Fraud monitoring</div>
        </div>
      </div>

      <div className="header-center">
        <div className="stream-controls">
          {!streaming ? (
            <button className="btn btn-primary btn-sm" type="button" onClick={onStartStream} disabled={!signedIn}>
              Start stream
            </button>
          ) : (
            <button className="btn btn-danger btn-sm" type="button" onClick={onStopStream}>
              Stop
            </button>
          )}
          {streaming && (
            <span className="live-indicator">
              <span className="live-dot" />
              Live
            </span>
          )}
          <label className="toggle">
            <input
              type="checkbox"
              checked={scoreStream}
              onChange={(e) => onScoreStreamChange(e.target.checked)}
              disabled={!signedIn}
            />
            Auto-score
          </label>
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            onClick={onLoadBatch}
            disabled={batchLoading || !signedIn}
          >
            {batchLoading ? "Loading…" : "Load batch"}
          </button>
        </div>
      </div>

      <div className="header-actions">
        <div className="status-group">
          <StatusDot state={fraudHealth} label="API" />
          <StatusDot state={streamHealth} label="Stream" />
        </div>

        {signedIn && (
          <div className="auth-signed-in">
            <span className="user-badge">
              <span className="user-avatar">{username.charAt(0).toUpperCase()}</span>
              {username}
            </span>
            <button className="btn btn-ghost btn-sm" type="button" onClick={onLogout}>
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
