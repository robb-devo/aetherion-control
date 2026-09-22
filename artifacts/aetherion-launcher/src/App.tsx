import { useEffect, useMemo, useRef, useState } from "react";
import type { AppState, ProgressEvent, Settings, UpdateStatus } from "./vite-env";
import { PlayView } from "./components/PlayView";
import { ServerView } from "./components/ServerView";
import { SettingsView } from "./components/SettingsView";
import { TitleBar } from "./components/TitleBar";
import { AetherionMark } from "./components/Mark";

type Busy = "idle" | "login" | "install" | "launch" | "running";
type Mode = "play" | "servers" | "settings";

function messageOf(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [busy, setBusy] = useState<Busy>("idle");
  const phaseRef = useRef<Busy>("idle");
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("play");
  const [update, setUpdate] = useState<UpdateStatus | null>(null);

  function setPhase(next: Busy) {
    phaseRef.current = next;
    setBusy(next);
  }

  useEffect(() => {
    if (!window.aetherion) return;
    void window.aetherion.getState().then((next) => {
      setState(next);
      setUpdate(next.update);
    }).catch((err) => setError(messageOf(err)));

    const offProgress = window.aetherion.onProgress((evt) => {
      if (phaseRef.current === "running") return;
      setProgress(evt);
    });
    const offRunning = window.aetherion.onRunning(() => {
      phaseRef.current = "running";
      setBusy("running");
      setProgress(null);
    });
    const offClose = window.aetherion.onClose(() => {
      phaseRef.current = "idle";
      setBusy("idle");
      setProgress(null);
    });
    const offUpdate = window.aetherion.onUpdate((next) => setUpdate(next));
    void window.aetherion.updateStatus().then(setUpdate).catch(() => {
      /* packaged builds report this; dev has no release feed */
    });
    return () => {
      offProgress();
      offRunning();
      offClose();
      offUpdate();
    };
  }, []);

  const packReady = state?.pack.complete ?? false;
  const signedIn = Boolean(state?.account);

  const statusMessage = useMemo(() => {
    if (busy === "running") return "Minecraft is running";
    if (error) return error;
    if ((busy === "login" || busy === "install" || busy === "launch") && progress?.message) {
      return progress.message;
    }
    if (busy === "login") return "Waiting for Microsoft sign-in…";
    if (busy === "install") return "Installing client pack…";
    if (busy === "launch") return "Launching Minecraft…";
    if (!signedIn) return "Sign in with Microsoft to play.";
    if (!packReady) return "Client pack not installed yet.";
    return "Ready when you are.";
  }, [busy, error, packReady, progress, signedIn]);

  async function refresh() {
    const next = await window.aetherion.getState();
    setState(next);
    setUpdate(next.update);
    return next;
  }

  async function onLogin() {
    if (!window.aetherion) {
      setError("Open the AETHERION desktop app to sign in.");
      return;
    }
    setError(null);
    setPhase("login");
    try {
      const account = await window.aetherion.login();
      setState((prev) => (prev ? { ...prev, account } : prev));
      await refresh();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      if (phaseRef.current === "login") setPhase("idle");
    }
  }

  async function onLogout() {
    if (!window.aetherion) return;
    setError(null);
    await window.aetherion.logout();
    setState((prev) => (prev ? { ...prev, account: null } : prev));
  }

  async function onInstall() {
    if (!window.aetherion) {
      setError("Open the AETHERION desktop app to install the pack.");
      return;
    }
    setError(null);
    setPhase("install");
    setProgress({ phase: "mods", message: "Preparing pack…", progress: 0 });
    try {
      const pack = await window.aetherion.installPack();
      setState((prev) => (prev ? { ...prev, pack } : prev));
    } catch (err) {
      setError(messageOf(err));
    } finally {
      if (phaseRef.current === "install") setPhase("idle");
      setProgress(null);
    }
  }

  async function onPlay() {
    if (!window.aetherion) {
      setError("Open the AETHERION desktop app to play.");
      return;
    }
    setMode("play");
    setError(null);
    setPhase("launch");
    setProgress({ phase: "launch", message: "Preparing…", progress: 0 });
    try {
      let snapshot = state;
      if (!snapshot?.account) {
        setPhase("login");
        await window.aetherion.login();
        snapshot = await refresh();
      }
      if (!snapshot?.account) throw new Error("Sign in with Microsoft first.");
      if (!snapshot.pack.complete) {
        setPhase("install");
        const pack = await window.aetherion.installPack();
        setState((prev) => (prev ? { ...prev, pack } : prev));
        setPhase("launch");
      }
      await window.aetherion.play();
      phaseRef.current = "running";
      setBusy("running");
      setProgress(null);
    } catch (err) {
      setError(messageOf(err));
      setPhase("idle");
      setProgress(null);
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

  async function onUseNetwork() {
    const settings = await window.aetherion.setPlayTarget({ kind: "network" });
    setState((prev) => (prev ? { ...prev, settings } : prev));
  }

  async function onSaveAdvanced(patch: { controlApiBase?: string; controlKey?: string }) {
    if (!window.aetherion) {
      setError("Open the AETHERION desktop app to change the API.");
      return;
    }
    const settings = await window.aetherion.updateSettings(patch);
    setState((prev) => (prev ? { ...prev, settings } : prev));
  }

  function onSettings(next: Settings) {
    setState((prev) => (prev ? { ...prev, settings: next } : prev));
  }

  async function onUpdate() {
    setError(null);
    try {
      await window.aetherion.startUpdate();
    } catch (err) {
      setError(messageOf(err));
    }
  }

  const version = state?.appVersion ?? update?.currentVersion ?? "1.3.1";

  return (
    <div className="app">
      <div className="backdrop" aria-hidden>
        <div className="backdrop-image" />
        <div className="backdrop-scrim" />
      </div>

      <TitleBar />

      <div className="shell">
        <nav className="nav" aria-label="Sections">
          <div className="nav-brand">
            <AetherionMark size={36} />
            <div>
              <strong>AETHERION</strong>
              <span>Launcher</span>
            </div>
          </div>

          <div className="nav-links" role="tablist">
            <button type="button" role="tab" aria-selected={mode === "play"} className={mode === "play" ? "on" : ""} onClick={() => setMode("play")}>
              Play
            </button>
            <button type="button" role="tab" aria-selected={mode === "servers"} className={mode === "servers" ? "on" : ""} onClick={() => setMode("servers")}>
              Servers
            </button>
            <button type="button" role="tab" aria-selected={mode === "settings"} className={mode === "settings" ? "on" : ""} onClick={() => setMode("settings")}>
              Settings
              {update?.available ? <i className="nav-dot" /> : null}
            </button>
          </div>

          <button type="button" className="nav-account" onClick={() => (signedIn ? setMode("settings") : void onLogin())}>
            <span className={`avatar ${signedIn ? "live" : ""}`}>
              {state?.account?.avatar ? <img src={state.account.avatar} alt="" /> : null}
            </span>
            <span className="nav-account-meta">
              <strong>{state?.account?.name ?? "Sign in"}</strong>
              <em>{signedIn ? "Microsoft" : "Required to play"}</em>
            </span>
          </button>
        </nav>

        <main className={`content content-${mode}`}>
          {error && mode !== "play" ? <p className="form-error page-error">{error}</p> : null}
          {mode === "play" ? (
            <PlayView
              state={state}
              busy={busy}
              progress={progress}
              error={error}
              statusMessage={statusMessage}
              version={version}
              onPlay={() => void onPlay()}
              onInstall={() => void onInstall()}
              onUseNetwork={() => void onUseNetwork()}
            />
          ) : null}
          {mode === "servers" ? (
            <ServerView
              signedIn={signedIn}
              launchBusy={busy === "launch" || busy === "install" || busy === "login" || busy === "running"}
              onLogin={() => void onLogin()}
              onSettings={onSettings}
              onPlay={onPlay}
            />
          ) : null}
          {mode === "settings" ? (
            <SettingsView
              state={state}
              busy={busy}
              update={update}
              version={version}
              onLogin={() => void onLogin()}
              onLogout={() => void onLogout()}
              onRam={(value) => void onRam(value)}
              onAutoJoin={(value) => void onAutoJoin(value)}
              onSaveAdvanced={onSaveAdvanced}
              onUpdate={() => void onUpdate()}
            />
          ) : null}
        </main>
      </div>
    </div>
  );
}
