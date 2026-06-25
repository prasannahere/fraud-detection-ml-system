import { useEffect, type FormEvent } from "react";

type Props = {
  username: string;
  password: string;
  error: string;
  loading: boolean;
  onUsernameChange: (v: string) => void;
  onPasswordChange: (v: string) => void;
  onLogin: () => void;
};

export function LoginOverlay({
  username,
  password,
  error,
  loading,
  onUsernameChange,
  onPasswordChange,
  onLogin,
}: Props) {
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!loading) onLogin();
  };

  return (
    <div className="login-overlay" role="dialog" aria-modal="true" aria-labelledby="login-title">
      <div className="login-overlay-scrim" aria-hidden="true" />
      <div className="login-overlay-frame">
        <div className="login-overlay-brand" aria-hidden="true">
          <div className="header-logo">
            <svg viewBox="0 0 16 16" fill="none">
              <path
                d="M8 1.5L2 4.5v3.5c0 3.5 2.5 6 6 7.5 3.5-1.5 6-4 6-7.5V4.5L8 1.5z"
                stroke="currentColor"
                strokeWidth="1.25"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>
        <h2 id="login-title" className="login-overlay-title">
          Sign in to IEEE - CIS
        </h2>
        <p className="login-overlay-subtitle">
          Use your credentials to score transactions and view SHAP explanations.
        </p>

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="login-field">
            <span className="login-label">Username</span>
            <input
              className="input"
              value={username}
              onChange={(e) => onUsernameChange(e.target.value)}
              placeholder="admin"
              autoComplete="username"
              autoFocus
            />
          </label>
          <label className="login-field">
            <span className="login-label">Password</span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </label>

          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}

          <button className="btn btn-primary login-submit" type="submit" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
