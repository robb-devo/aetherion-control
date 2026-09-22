import { useEffect, useState } from "react";
import type { AppState, UpdateStatus } from "../vite-env";

type Busy = "idle" | "login" | "install" | "launch" | "running";

export function SettingsView({
  state,
  busy,
  update,
  version,
  onLogin,
  onLogout,
  onRam,
  onAutoJoin,
  onSaveAdvanced,
  onUpdate,
}: {
  state: AppState | null;
  busy: Busy;
  update: UpdateStatus | null;
  version: string;
  onLogin: () => void;
  onLogout: () => void;
  onRam: (value: number) => void;
  onAutoJoin: (value: boolean) => void;
  onSaveAdvanced: (patch: { controlApiBase?: string; controlKey?: string }) => Promise<void>;
  onUpdate: () => void;
}) {
  const signedIn = Boolean(state?.account);
  const locked = busy !== "idle" || !state;
  const [apiBase, setApiBase] = useState(state?.settings.controlApiBase ?? "");
  const [apiTouched, setApiTouched] = useState(false);
  const [serviceKey, setServiceKey] = useState("");

  useEffect(() => {
    if (!apiTouched) setApiBase(state?.settings.controlApiBase ?? "");
  }, [apiTouched, state?.settings.controlApiBase]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  async function saveAdvanced(patch: { controlApiBase?: string; controlKey?: string }, message: string) {
    setLocalError(null);
    setNotice(null);
    try {
      await onSaveAdvanced(patch);
      setServiceKey("");
      setNotice(message);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="page settings-page">
      <header className="page-head">
        <p className="eyebrow">Settings</p>
        <h1>Preferences</h1>
        <p className="lede">Account, memory, and updates for this install.</p>
      </header>

      <section className="card">
        <h2>Account</h2>
        <div className="account-row">
          <span className={`avatar ${signedIn ? "live" : ""}`}>
            {state?.account?.avatar ? <img src={state.account.avatar} alt="" /> : null}
          </span>
          <div>
            <strong>{state?.account?.name ?? "Not signed in"}</strong>
            <span>{signedIn ? "Microsoft account" : "Required to launch and to create servers"}</span>
          </div>
          {signedIn ? (
            <button type="button" className="text-btn" onClick={onLogout}>Sign out</button>
          ) : (
            <button type="button" className="text-btn" disabled={busy !== "idle"} onClick={onLogin}>Sign in</button>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-title-row">
          <h2>Memory</h2>
          <strong>{state ? `${state.settings.ramGb} GB` : "—"}</strong>
        </div>
        {state ? (
          <input
            type="range"
            min={2}
            max={16}
            step={1}
            aria-label="Memory"
            value={state.settings.ramGb}
            disabled={busy !== "idle"}
            onChange={(e) => onRam(Number(e.target.value))}
          />
        ) : (
          <p className="hint">Shown when the desktop app has loaded your settings.</p>
        )}
        <p className="hint">Allocated to Minecraft. 2–16 GB.</p>
      </section>

      <section className="card">
        <button
          type="button"
          className="toggle"
          disabled={locked}
          onClick={() => onAutoJoin(!(state?.settings.autoJoin ?? true))}
        >
          <span>
            <strong>Auto-join on launch</strong>
            <em>Opens the selected server when Minecraft starts</em>
          </span>
          <span className={`toggle-switch ${state?.settings.autoJoin ? "on" : ""}`}>
            <span />
          </span>
        </button>
      </section>

      <section className="card">
        <h2>Updates</h2>
        <p className="hint">
          {update?.available && update.version
            ? `Version ${update.version} is ready.`
            : `AETHERION ${version} is the installed build.`}
        </p>
        {update?.available && update.version ? (
          <button type="button" className="ghost-btn" disabled={busy !== "idle"} onClick={onUpdate}>
            Update to {update.version}
          </button>
        ) : (
          <p className="hint quiet">Update checks run from the installed Windows app.</p>
        )}
      </section>

      <section className="card">
        <button type="button" className="advanced-toggle" onClick={() => setAdvancedOpen((open) => !open)}>
          <h2>Advanced</h2>
          <span>{advancedOpen ? "Hide" : "Show"}</span>
        </button>
        {advancedOpen ? (
          <div className="advanced-body">
            <p className="hint">
              Override the control API. Leave the key blank to keep the built-in connection.
              {state?.settings.controlKeySet ? " A custom key is saved on this PC." : ""}
            </p>
            <label>
              API base
              <input
                value={apiBase}
                placeholder={state?.settings.apiBase || "http://135.181.18.162:5055"}
                onChange={(e) => {
                  setApiTouched(true);
                  setApiBase(e.target.value);
                }}
                spellCheck={false}
              />
            </label>
            <label>
              Service key
              <input
                type="password"
                value={serviceKey}
                placeholder={state?.settings.controlKeySet ? "Saved — enter a new key to replace it" : "Leave blank to use the built-in key"}
                onChange={(e) => setServiceKey(e.target.value)}
                autoComplete="off"
              />
            </label>
            {localError ? <p className="form-error">{localError}</p> : null}
            {notice ? <p className="form-notice">{notice}</p> : null}
            <div className="row-actions">
              <button
                type="button"
                className="ghost-btn"
                disabled={!state}
                onClick={() => void saveAdvanced(
                  {
                    controlApiBase: apiBase.trim(),
                    ...(serviceKey.trim() ? { controlKey: serviceKey.trim() } : {}),
                  },
                  "Saved",
                )}
              >
                Save
              </button>
              <button
                type="button"
                className="text-btn"
                disabled={!state}
                onClick={() => {
                  setApiBase("");
                  setServiceKey("");
                  void saveAdvanced({ controlApiBase: "", controlKey: "" }, "Reset to the built-in connection");
                }}
              >
                Reset
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
