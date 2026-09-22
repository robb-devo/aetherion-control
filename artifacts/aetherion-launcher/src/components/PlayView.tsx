import type { AppState, ProgressEvent } from "../vite-env";
import { AetherionMark } from "./Mark";

type Busy = "idle" | "login" | "install" | "launch";

export function PlayView({
  state,
  busy,
  progress,
  error,
  statusMessage,
  onPlay,
  onInstall,
  onLogin,
  onLogout,
  onRam,
  onAutoJoin,
  onUseNetwork,
}: {
  state: AppState | null;
  busy: Busy;
  progress: ProgressEvent | null;
  error: string | null;
  statusMessage: string;
  onPlay: () => void;
  onInstall: () => void;
  onLogin: () => void;
  onLogout: () => void;
  onRam: (value: number) => void;
  onAutoJoin: (value: boolean) => void;
  onUseNetwork: () => void;
}) {
  const packReady = state?.pack.complete ?? false;
  const signedIn = Boolean(state?.account);
  const progressPct = Math.round((progress?.progress ?? 0) * 100);
  const showProgress = busy === "install" || busy === "launch" || Boolean(progress && progress.progress < 1);
  const playLabel = !signedIn ? "Sign in & Play" : packReady ? "Play" : "Install & Play";
  const target = state?.settings.playTarget;
  const onSandbox = target?.kind === "sandbox";

  return (
    <>
      <section className="hero">
        <div className="brand-mark">
          <AetherionMark size={54} />
          <div className="brand-text">
            <h1>AETHERION</h1>
            <p className="kicker">
              <span className="kicker-accent">Ethereal Realm</span>
              <span className="kicker-dot">·</span>
              <span>Fabric {state?.pack.minecraft ?? "1.21.1"}</span>
            </p>
          </div>
        </div>

        <p className="tagline">
          Sign in, install the client pack, and join. One path — Microsoft, Fabric, and the network.
        </p>

        {target ? (
          <div className={`target-pill ${onSandbox ? "sandbox" : ""}`}>
            <span>Joining</span>
            <strong>{target.name}</strong>
            <em>{target.label}</em>
            {onSandbox ? (
              <button type="button" className="pill-action" disabled={busy !== "idle"} onClick={onUseNetwork}>
                Use network
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="cta-row">
          <button
            type="button"
            className={`play-btn ${busy === "launch" || busy === "install" ? "busy" : ""}`}
            disabled={busy !== "idle"}
            onClick={onPlay}
          >
            {playLabel}
          </button>
          <button type="button" className="ghost-btn" disabled={busy !== "idle"} onClick={onInstall}>
            {packReady ? "Repair pack" : "Download pack"}
          </button>
        </div>

        <div className="status-line">
          <div className={`status-text ${error ? "error" : ""}`}>{statusMessage}</div>
          {showProgress ? (
            <div className="progress" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${Math.max(6, progressPct)}%` }} />
            </div>
          ) : null}
        </div>
      </section>

      <aside className="panel">
        <div className="panel-section">
          <div className="panel-label">Account</div>
          <div className="account-row">
            <div className={`avatar ${signedIn ? "live" : ""}`}>
              {state?.account?.avatar ? <img src={state.account.avatar} alt="" /> : null}
            </div>
            <div className="account-meta">
              <strong>{state?.account?.name ?? "Not signed in"}</strong>
              <span>{signedIn ? "Microsoft account" : "Required to launch"}</span>
            </div>
            {signedIn ? (
              <button type="button" className="linkish" onClick={onLogout}>
                Sign out
              </button>
            ) : (
              <button type="button" className="linkish" disabled={busy !== "idle"} onClick={onLogin}>
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
              <strong>{target?.label ?? state?.settings.serverAddress ?? "play.donnernet.de"}</strong>
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
            aria-label="Memory"
            value={state?.settings.ramGb ?? 6}
            disabled={!state || busy !== "idle"}
            onChange={(e) => onRam(Number(e.target.value))}
          />
        </div>

        <div className="panel-section">
          <button
            type="button"
            className="toggle"
            disabled={!state || busy !== "idle"}
            onClick={() => onAutoJoin(!(state?.settings.autoJoin ?? true))}
          >
            <span>Auto-join on launch</span>
            <span className={`toggle-switch ${(state?.settings.autoJoin ?? true) ? "on" : ""}`}>
              <span />
            </span>
          </button>
        </div>
      </aside>
    </>
  );
}
