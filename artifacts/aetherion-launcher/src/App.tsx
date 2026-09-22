import { useEffect, useMemo, useState } from "react";
import type { AppState, ControlSession, ProgressEvent, Settings, UpdateStatus } from "./vite-env";
import { PlayView } from "./components/PlayView";
import { ServerView } from "./components/ServerView";
import { TitleBar } from "./components/TitleBar";

type Busy = "idle" | "login" | "install" | "launch";
type Mode = "play" | "server";

function messageOf(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [busy, setBusy] = useState<Busy>("idle");
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("play");
  const [update, setUpdate] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    if (!window.aetherion) return;
    void window.aetherion.getState().then((next) => {
      setState(next);
      setUpdate(next.update);
    }).catch((err) => setError(messageOf(err)));

    const offProgress = window.aetherion.onProgress((evt) => setProgress(evt));
    const offClose = window.aetherion.onClose(() => {
      setBusy("idle");
      setProgress(null);
    });
    const offUpdate = window.aetherion.onUpdate((next) => setUpdate(next));
    void window.aetherion.updateStatus().then(setUpdate).catch(() => {
      /* packaged builds report this; dev has no release feed */
    });
    return () => {
      offProgress();
      offClose();
      offUpdate();
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
    setBusy("login");
    try {
      const account = await window.aetherion.login();
      setState((prev) => (prev ? { ...prev, account } : prev));
      await refresh();
    } catch (err) {
      setError(messageOf(err));
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
      setError(messageOf(err));
    } finally {
      setBusy("idle");
    }
  }

  async function onPlay() {
    if (!window.aetherion) {
      setError("Open the AETHERION desktop app to play.");
      return;
    }
    setMode("play");
    setError(null);
    setBusy("launch");
    setProgress({ phase: "launch", message: "Preparing…", progress: 0 });
    try {
      let snapshot = state;
      if (!snapshot?.account) {
        setBusy("login");
        await window.aetherion.login();
        snapshot = await refresh();
      }
      if (!snapshot?.account) throw new Error("Sign in with Microsoft first.");
      if (!snapshot.pack.complete) {
        setBusy("install");
        const pack = await window.aetherion.installPack();
        setState((prev) => (prev ? { ...prev, pack } : prev));
        setBusy("launch");
      }
      await window.aetherion.play();
      setProgress({ phase: "launch", message: "Minecraft is starting…", progress: 1 });
    } catch (err) {
      setError(messageOf(err));
      setBusy("idle");
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

  async function onUpdate() {
    setError(null);
    try {
      await window.aetherion.startUpdate();
    } catch (err) {
      setError(messageOf(err));
    }
  }

  function onControl(next: ControlSession) {
    setState((prev) => (prev ? { ...prev, control: next } : prev));
  }

  function onSettings(next: Settings) {
    setState((prev) => (prev ? { ...prev, settings: next } : prev));
  }

  return (
    <div className="app">
      <div className="backdrop" aria-hidden>
        <div className="backdrop-image" />
        <div className="backdrop-scrim" />
        <div className="backdrop-vignette" />
      </div>

      <TitleBar
        version={state?.appVersion ?? update?.currentVersion ?? "1.3.0"}
        update={update}
        busy={busy !== "idle"}
        onUpdate={() => void onUpdate()}
      />

      <main className={`stage ${mode === "server" ? "stage-server" : "stage-play"}`}>
        <div className="mode-row" role="tablist" aria-label="Sections">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "play"}
            className={mode === "play" ? "on" : ""}
            onClick={() => setMode("play")}
          >
            Play
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "server"}
            className={mode === "server" ? "on" : ""}
            onClick={() => setMode("server")}
          >
            Your own Server
          </button>
        </div>

        {mode === "play" ? (
          <PlayView
            state={state}
            busy={busy}
            progress={progress}
            error={error}
            statusMessage={statusMessage}
            onPlay={() => void onPlay()}
            onInstall={() => void onInstall()}
            onLogin={() => void onLogin()}
            onLogout={() => void onLogout()}
            onRam={(value) => void onRam(value)}
            onAutoJoin={(value) => void onAutoJoin(value)}
            onUseNetwork={() => void onUseNetwork()}
          />
        ) : (
          <ServerView
            control={state?.control ?? null}
            launchBusy={busy !== "idle"}
            onControl={onControl}
            onSettings={onSettings}
            onPlay={onPlay}
          />
        )}
      </main>
    </div>
  );
}
