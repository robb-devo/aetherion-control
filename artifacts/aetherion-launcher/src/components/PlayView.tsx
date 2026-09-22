import type { AppState, ProgressEvent } from "../vite-env";

type Busy = "idle" | "login" | "install" | "launch" | "running";

export function PlayView({
  state,
  busy,
  progress,
  error,
  statusMessage,
  version,
  onPlay,
  onInstall,
  onUseNetwork,
}: {
  state: AppState | null;
  busy: Busy;
  progress: ProgressEvent | null;
  error: string | null;
  statusMessage: string;
  version: string;
  onPlay: () => void;
  onInstall: () => void;
  onUseNetwork: () => void;
}) {
  const packReady = state?.pack.complete ?? false;
  const signedIn = Boolean(state?.account);
  const running = busy === "running";
  const working = busy === "install" || busy === "launch" || busy === "login";
  const progressPct = Math.round((progress?.progress ?? 0) * 100);
  const showProgress = working && progress != null;
  const playLabel = running ? "Running" : !signedIn ? "Sign in & Play" : packReady ? "Play" : "Install & Play";
  const target = state?.settings.playTarget;
  const onSandbox = target?.kind === "sandbox";

  return (
    <div className="page play-page">
      <header className="page-head">
        <p className="eyebrow">Instance</p>
        <h1>AETHERION</h1>
        <p className="lede">
          Fabric {state?.pack.minecraft ?? "client"} · v{version}
        </p>
      </header>

      {target ? (
        <div className={`target-card ${onSandbox ? "sandbox" : ""}`}>
          <div>
            <span>Joining</span>
            <strong>{target.name}</strong>
            <em>{target.label}</em>
          </div>
          {onSandbox ? (
            <button type="button" className="text-btn" disabled={busy !== "idle"} onClick={onUseNetwork}>
              Use network
            </button>
          ) : null}
        </div>
      ) : (
        <div className="target-card">
          <div>
            <span>Joining</span>
            <strong>AETHERION</strong>
            <em>{state?.settings.serverAddress ?? "—"}</em>
          </div>
        </div>
      )}

      <div className="cta-row">
        <button type="button" className={`play-btn ${working ? "busy" : ""} ${running ? "running" : ""}`} disabled={busy !== "idle"} onClick={onPlay}>
          {playLabel}
        </button>
        <button type="button" className="ghost-btn" disabled={busy !== "idle"} onClick={onInstall}>
          {packReady ? "Repair pack" : "Download pack"}
        </button>
      </div>

      <div className="status-line">
        <div className={`status-text ${error ? "error" : ""} ${running ? "live" : ""}`}>{statusMessage}</div>
        {showProgress ? (
          <div className="progress" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${Math.max(8, progressPct)}%` }} />
          </div>
        ) : null}
      </div>

      <section className="summary">
        <div>
          <em>Pack</em>
          <strong className={state ? (packReady ? "ok" : "warn") : ""}>
            {state ? `${state.pack.present}/${state.pack.total} mods` : "—"}
          </strong>
        </div>
        <div>
          <em>Minecraft</em>
          <strong>{state?.pack.minecraft ?? "—"}</strong>
        </div>
        <div>
          <em>Loader</em>
          <strong>{state?.pack.loader ? `Fabric ${state.pack.loader}` : "—"}</strong>
        </div>
        <div>
          <em>Server</em>
          <strong>{target?.label ?? state?.settings.serverAddress ?? "—"}</strong>
        </div>
      </section>
    </div>
  );
}
