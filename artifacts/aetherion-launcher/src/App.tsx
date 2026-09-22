import { useEffect, useMemo, useState } from "react";
import type { AppState, ProgressEvent } from "./vite-env";

type Busy = "idle" | "login" | "install" | "launch";

function AetherionMark({ size = 46 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className="brand-svg"
      aria-hidden
    >
      <defs>
        <radialGradient id="ae-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="62%" stopColor="#b89ad8" stopOpacity="0.12" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="30" fill="url(#ae-glow)" />
      <circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" strokeWidth="1.15" opacity="0.82" />
      <circle cx="32" cy="32" r="22" fill="none" stroke="#b89ad8" strokeWidth="0.7" opacity="0.7" />
      <g stroke="currentColor" strokeWidth="1" opacity="0.55">
        <line x1="32" y1="4" x2="32" y2="10" />
        <line x1="32" y1="54" x2="32" y2="60" />
        <line x1="4" y1="32" x2="10" y2="32" />
        <line x1="54" y1="32" x2="60" y2="32" />
      </g>
      <path
        d="M32 16 L22 46 L26 46 L28.5 39 L35.5 39 L38 46 L42 46 L32 16 Z M30 35 L32 28 L34 35 Z"
        fill="currentColor"
      />
    </svg>
  );
}

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [busy, setBusy] = useState<Busy>("idle");
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.aetherion.getState().then(setState).catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
    });

    const offProgress = window.aetherion.onProgress((evt) => setProgress(evt));
    const offClose = window.aetherion.onClose(() => {
      setBusy("idle");
      setProgress(null);
    });
    return () => {
      offProgress();
      offClose();
    };
  }, []);

  const packReady = state?.pack.complete ?? false;
  const signedIn = Boolean(state?.account);

  const statusMessage = useMemo(() => {
    if (error) return error;
    if (progress?.message) return progress.message;
    if (busy === "login") return "Waiting for Microsoft sign-in…";
    if (busy === "install") return "Installing client pack…";
    if (busy === "launch") return "Launching Minecraft…";
    if (!signedIn) return "Sign in with Microsoft to play.";
    if (!packReady) return "Client pack not installed yet.";
    return "Ready when you are.";
  }, [busy, error, packReady, progress, signedIn]);

  const progressPct = Math.round((progress?.progress ?? 0) * 100);

  async function refresh() {
    const next = await window.aetherion.getState();
    setState(next);
  }

  async function onLogin() {
    setError(null);
    setBusy("login");
    try {
      const account = await window.aetherion.login();
      setState((prev) => (prev ? { ...prev, account } : prev));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("idle");
    }
  }

  async function onLogout() {
    setError(null);
    await window.aetherion.logout();
    setState((prev) => (prev ? { ...prev, account: null } : prev));
  }

  async function onInstall() {
    setError(null);
    setBusy("install");
    setProgress({ phase: "mods", message: "Preparing pack…", progress: 0 });
    try {
      const pack = await window.aetherion.installPack();
      setState((prev) => (prev ? { ...prev, pack } : prev));
      setProgress({ phase: "mods", message: "Pack installed", progress: 1 });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("idle");
    }
  }

  async function onPlay() {
    setError(null);
    if (!signedIn) {
      await onLogin();
      return;
    }
    setBusy("launch");
    setProgress({ phase: "launch", message: "Preparing…", progress: 0 });
    try {
      if (!packReady) {
        setBusy("install");
        const pack = await window.aetherion.installPack();
        setState((prev) => (prev ? { ...prev, pack } : prev));
        setBusy("launch");
      }
      await window.aetherion.play();
      setProgress({ phase: "launch", message: "Minecraft is starting…", progress: 1 });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy("idle");
    }
  }

  async function onRam(value: number) {
    const settings = await window.aetherion.updateSettings({ ramGb: value });
    setState((prev) => (prev ? { ...prev, settings } : prev));
  }

  async function onAutoJoin(value: boolean) {
    const settings = await window.aetherion.updateSettings({ autoJoin: value });
    setState((prev) => (prev ? { ...prev, settings } : prev));
  }

  return (
    <div className="app">
      <div className="backdrop" aria-hidden>
        <div className="backdrop-image" />
        <div className="backdrop-scrim" />
        <div className="backdrop-vignette" />
      </div>

      <header className="titlebar">
        <div className="titlebar-brand">AETHERION</div>
        <div className="titlebar-actions">
          <button type="button" aria-label="Minimize" onClick={() => void window.aetherion.minimize()}>
            ─
          </button>
          <button
            type="button"
            className="close"
            aria-label="Close"
            onClick={() => void window.aetherion.close()}
          >
            ✕
          </button>
        </div>
      </header>

      <main className="stage">
        <section className="hero">
          <div className="brand-mark">
            <AetherionMark size={52} />
            <div className="brand-text">
              <h1>AETHERION</h1>
              <p className="kicker">
                <span className="kicker-accent">Ethereal Realm</span>
                <span className="kicker-dot">·</span>
                <span>Fabric 1.21.1</span>
              </p>
            </div>
          </div>

          <p className="tagline">
            Cross the veil. One client pack, Microsoft sign-in, and a direct join to the
            network — no clutter, no fake stats.
          </p>

          <div className="cta-row">
            <button
              type="button"
              className={`play-btn ${busy === "launch" || busy === "install" ? "busy" : ""}`}
              disabled={busy !== "idle" && busy !== "launch"}
              onClick={() => void onPlay()}
            >
              {!signedIn ? "Sign in & Play" : packReady ? "Play" : "Install & Play"}
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={busy !== "idle"}
              onClick={() => void onInstall()}
            >
              {packReady ? "Repair pack" : "Download pack"}
            </button>
          </div>

          <div className="status-line">
            <div className={`status-text ${error ? "error" : ""}`}>{statusMessage}</div>
            {(busy === "install" || busy === "launch" || (progress && progress.progress < 1)) && (
              <div className="progress" aria-hidden>
                <span style={{ width: `${Math.max(4, progressPct)}%` }} />
              </div>
            )}
          </div>
        </section>

        <aside className="panel">
          <div className="panel-section">
            <div className="panel-label">Account</div>
            <div className="account-row">
              <div className="avatar">
                {state?.account?.avatar ? <img src={state.account.avatar} alt="" /> : null}
              </div>
              <div className="account-meta">
                <strong>{state?.account?.name ?? "Not signed in"}</strong>
                <span>{signedIn ? "Microsoft account" : "Required to launch"}</span>
              </div>
              {signedIn ? (
                <button type="button" className="linkish" onClick={() => void onLogout()}>
                  Sign out
                </button>
              ) : (
                <button
                  type="button"
                  className="linkish"
                  disabled={busy !== "idle"}
                  onClick={() => void onLogin()}
                >
                  Sign in
                </button>
              )}
            </div>
          </div>

          <div className="divider" />

          <div className="panel-section">
            <div className="panel-label">Client</div>
            <div className="stat-grid">
              <div className="stat">
                <em>Pack</em>
                <strong className={packReady ? "ok" : "warn"}>
                  {state ? `${state.pack.present}/${state.pack.total} mods` : "—"}
                </strong>
              </div>
              <div className="stat">
                <em>Server</em>
                <strong>{state?.settings.serverAddress ?? "play.donnernet.de"}</strong>
              </div>
              <div className="stat">
                <em>Minecraft</em>
                <strong>{state?.pack.minecraft ?? "1.21.1"}</strong>
              </div>
              <div className="stat">
                <em>Loader</em>
                <strong>Fabric {state?.pack.loader ?? "—"}</strong>
              </div>
            </div>
          </div>

          <div className="divider" />

          <div className="panel-section">
            <div className="ram-row">
              <div className="panel-label">Memory</div>
              <div className="ram-value">{state?.settings.ramGb ?? 6} GB</div>
            </div>
            <input
              type="range"
              min={2}
              max={16}
              step={1}
              value={state?.settings.ramGb ?? 6}
              disabled={!state || busy !== "idle"}
              onChange={(e) => void onRam(Number(e.target.value))}
            />
          </div>

          <div className="panel-section">
            <button
              type="button"
              className="toggle"
              disabled={!state || busy !== "idle"}
              onClick={() => void onAutoJoin(!(state?.settings.autoJoin ?? true))}
            >
              <span>Auto-join server on launch</span>
              <span className={`toggle-switch ${(state?.settings.autoJoin ?? true) ? "on" : ""}`}>
                <span />
              </span>
            </button>
          </div>

          <div className="footer-note">v{state?.appVersion ?? "1.2.3"} · Windows</div>
        </aside>
      </main>
    </div>
  );
}
