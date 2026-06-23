type HealthState = "ok" | "degraded" | "offline" | "checking";

type Props = {
  fraudHealth: HealthState;
  streamHealth: HealthState;
  signedIn: boolean;
  username: string;
  password: string;
  streaming: boolean;
  scoreStream: boolean;
  onUsernameChange: (v: string) => void;
  onPasswordChange: (v: string) => void;
  onLogin: () => void;
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
  password,
  streaming,
  scoreStream,
  onUsernameChange,
  onPasswordChange,
  onLogin,
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
            <button className="btn btn-primary btn-sm" type="button" onClick={onStartStream}>
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

        {!signedIn ? (
          <div className="auth-form">
            <input
              className="input input-sm"
              value={username}
              onChange={(e) => onUsernameChange(e.target.value)}
              placeholder="Username"
              aria-label="Username"
            />
            <input
              className="input input-sm"
              type="password"
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              placeholder="Password"
              aria-label="Password"
              onKeyDown={(e) => e.key === "Enter" && onLogin()}
            />
            <button className="btn btn-primary btn-sm" type="button" onClick={onLogin}>
              Sign in
            </button>
          </div>
        ) : (
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
