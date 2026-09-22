import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { ControlSession, SandboxOptions, SandboxServer, Settings } from "../vite-env";

type LocalBusy = "idle" | "load" | "create" | "row" | "upload";

const DEFAULT_API = "http://135.181.18.162:5055";

function messageOf(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

export function ServerView({
  control,
  launchBusy,
  onControl,
  onSettings,
  onPlay,
}: {
  control: ControlSession | null;
  launchBusy: boolean;
  onControl: (next: ControlSession) => void;
  onSettings: (next: Settings) => void;
  onPlay: () => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [apiBase, setApiBase] = useState(control?.apiBase || "");
  const [options, setOptions] = useState<SandboxOptions | null>(null);
  const [servers, setServers] = useState<SandboxServer[]>([]);
  const [name, setName] = useState("");
  const [serverType, setServerType] = useState("paper");
  const [version, setVersion] = useState("");
  const [preset, setPreset] = useState("balanced");
  const [busy, setBusy] = useState<LocalBusy>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploadFor, setUploadFor] = useState<string | null>(null);
  const [uploadPath, setUploadPath] = useState("");
  const [uploadText, setUploadText] = useState("");

  const locked = busy !== "idle" || launchBusy;
  const versions = options?.versions?.[serverType] ?? [];
  const selectedPreset = options?.presets.find((item) => item.value === preset) ?? options?.presets[0];
  const selectedVersion = useMemo(() => {
    if (version && versions.includes(version)) return version;
    return versions.find((item) => item.startsWith("1.21")) ?? versions[0] ?? "";
  }, [version, versions]);

  async function load() {
    setBusy("load");
    setError(null);
    try {
      const [nextOptions, list] = await Promise.all([
        window.aetherion.sandboxOptions(),
        window.aetherion.sandboxList(),
      ]);
      setOptions(nextOptions);
      setServers(list.servers);
      if (!nextOptions.presets.some((item) => item.value === preset) && nextOptions.presets[0]) {
        setPreset(nextOptions.presets[0].value);
      }
      if (nextOptions.serverTypes[0] && !nextOptions.serverTypes.some((item) => item.value === serverType)) {
        setServerType(nextOptions.serverTypes[0].value);
      }
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy("idle");
    }
  }

  useEffect(() => {
    if (control?.apiBase) {
      setApiBase((current) => current || control.apiBase);
    }
  }, [control?.apiBase]);

  useEffect(() => {
    if (!control?.unlocked || !control.canSandbox || !window.aetherion) return;
    void load();
  }, [control?.unlocked, control?.displayName, control?.canSandbox]);

  async function onUnlock(event: FormEvent) {
    event.preventDefault();
    if (!window.aetherion) {
      setError("Open this screen in the AETHERION app.");
      return;
    }
    setBusy("load");
    setError(null);
    try {
      const next = await window.aetherion.unlockControl({
        code,
        apiBase: apiBase.trim() || undefined,
      });
      setCode("");
      onControl(next);
      if (!next.canSandbox) {
        setError("This access code cannot use sandbox servers.");
      }
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy("idle");
    }
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (!selectedPreset || !selectedVersion) return;
    setBusy("create");
    setError(null);
    setNotice(null);
    try {
      const created = await window.aetherion.sandboxCreate({
        name,
        serverType,
        version: selectedVersion,
        ramGb: selectedPreset.ramGb,
        cpuCores: selectedPreset.cpuCores,
        preset: selectedPreset.value,
        startAfterCreate: true,
      });
      setNotice(`${created.name} · ${created.address}`);
      setName("");
      await load();
    } catch (err) {
      setError(messageOf(err));
      setBusy("idle");
    }
  }

  async function onStart(server: SandboxServer) {
    setBusy("row");
    setError(null);
    setNotice(null);
    try {
      const result = await window.aetherion.sandboxStart(server.id);
      setNotice(result.running ? `Online · ${result.address}` : `Start queued · ${result.address}`);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy("idle");
    }
  }

  async function onDelete(server: SandboxServer) {
    if (!window.confirm(`Delete ${server.name}? This removes the sandbox and its world.`)) return;
    setBusy("row");
    setError(null);
    try {
      await window.aetherion.sandboxDelete(server.id);
      setServers((prev) => prev.filter((item) => item.id !== server.id));
      setNotice(`${server.name} deleted`);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy("idle");
    }
  }

  async function onJoin(server: SandboxServer) {
    setBusy("row");
    setError(null);
    try {
      const settings = await window.aetherion.setPlayTarget({
        kind: "sandbox",
        name: server.name,
        address: server.address,
        port: server.port,
      });
      onSettings(settings);
      await onPlay();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy("idle");
    }
  }

  async function onUpload(server: SandboxServer) {
    const filePath = uploadPath.trim();
    if (!filePath) {
      setError("Choose a path inside the sandbox, such as config/note.txt.");
      return;
    }
    setBusy("upload");
    setError(null);
    try {
      const result = await window.aetherion.sandboxUpload({
        id: server.id,
        path: filePath,
        content: uploadText,
      });
      setNotice(`Uploaded ${result.path}`);
      setUploadText("");
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy("idle");
    }
  }

  if (!control?.unlocked) {
    return (
      <section className="server-view">
        <header className="server-head">
          <p className="kicker">
            <span className="kicker-accent">Private pool</span>
          </p>
          <h2>Your own Server</h2>
          <p>
            A small sandbox on the shared host — your access code only. RAM and CPU stay inside the existing pool limits.
          </p>
        </header>
        <form className="server-card" onSubmit={(event) => void onUnlock(event)}>
          <label>
            Access code
            <input
              className="text-input"
              type="password"
              autoComplete="off"
              value={code}
              disabled={locked}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <label>
            API
            <input
              className="text-input"
              value={apiBase}
              placeholder={control?.apiBase || DEFAULT_API}
              disabled={locked}
              onChange={(event) => setApiBase(event.target.value)}
            />
          </label>
          <button type="submit" className="ghost-btn solid" disabled={locked || code.trim().length < 4}>
            Connect
          </button>
          {error ? <p className="error">{error}</p> : null}
        </form>
      </section>
    );
  }

  return (
    <section className="server-view">
      <header className="server-head">
        <div className="server-head-row">
          <div>
            <p className="kicker">
              <span className="kicker-accent">{control.displayName || "Connected"}</span>
              <span className="kicker-dot">·</span>
              <span>{control.role || "access"}</span>
            </p>
            <h2>Your own Server</h2>
          </div>
          <button
            type="button"
            className="linkish"
            disabled={locked}
            onClick={() => {
              void window.aetherion.lockControl().then(onControl).catch((err) => setError(messageOf(err)));
            }}
          >
            Disconnect
          </button>
        </div>
        <p>Only servers created with this access code are listed. The pool cap is shared.</p>
        {options ? (
          <p className="pool-line">
            {options.remainingRamGb} GB RAM · {options.remainingCores} cores free of {options.poolGb} GB / {options.poolCores} cores
          </p>
        ) : null}
      </header>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="notice">{notice}</p> : null}

      <form className="server-card" onSubmit={(event) => void onCreate(event)}>
        <label>
          Name
          <input
            className="text-input"
            value={name}
            placeholder="isle"
            disabled={locked || !options}
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <div className="choice-row" role="group" aria-label="Preset">
          {(options?.presets ?? []).map((item) => (
            <button
              key={item.value}
              type="button"
              className={`choice ${preset === item.value ? "on" : ""}`}
              disabled={locked}
              onClick={() => setPreset(item.value)}
            >
              <strong>{item.label}</strong>
              <span>
                {item.ramGb} GB · {item.cpuCores} cores
              </span>
            </button>
          ))}
        </div>

        <div className="choice-row" role="group" aria-label="Server type">
          {(options?.serverTypes ?? []).map((item) => (
            <button
              key={item.value}
              type="button"
              className={`choice compact ${serverType === item.value ? "on" : ""}`}
              disabled={locked}
              onClick={() => setServerType(item.value)}
            >
              <strong>{item.label}</strong>
            </button>
          ))}
        </div>

        <label>
          Version
          <select
            className="text-input"
            value={selectedVersion}
            disabled={locked || versions.length === 0}
            onChange={(event) => setVersion(event.target.value)}
          >
            {versions.length === 0 ? <option value="">Waiting for versions…</option> : null}
            {versions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          className="play-btn slim"
          disabled={locked || !options || name.trim().length < 2 || !selectedVersion || !selectedPreset}
        >
          {busy === "create" ? "Creating…" : "Create server"}
        </button>
      </form>

      <div className="server-list">
        {servers.length === 0 ? <p className="quiet">No sandboxes for this access code yet.</p> : null}
        {servers.map((server) => (
          <article key={server.id} className="server-row">
            <div>
              <strong>{server.name}</strong>
              <span>
                {server.serverType} {server.version} · {server.ramGb} GB · {server.address}
              </span>
            </div>
            <div className="row-actions">
              <button type="button" className="linkish" disabled={locked} onClick={() => void onStart(server)}>
                Start
              </button>
              <button type="button" className="linkish" disabled={locked} onClick={() => void onJoin(server)}>
                Play
              </button>
              <button
                type="button"
                className="linkish"
                disabled={locked}
                onClick={() => {
                  setUploadFor((current) => (current === server.id ? null : server.id));
                  setUploadPath("config/aetherion.txt");
                }}
              >
                File
              </button>
              <button type="button" className="linkish danger" disabled={locked} onClick={() => void onDelete(server)}>
                Delete
              </button>
            </div>
            {uploadFor === server.id ? (
              <div className="upload-box">
                <label>
                  Path
                  <input
                    className="text-input"
                    value={uploadPath}
                    disabled={locked}
                    onChange={(event) => setUploadPath(event.target.value)}
                  />
                </label>
                <textarea
                  value={uploadText}
                  disabled={locked}
                  placeholder="Text only, 256 KB max"
                  onChange={(event) => setUploadText(event.target.value)}
                />
                <button type="button" className="ghost-btn" disabled={locked} onClick={() => void onUpload(server)}>
                  Upload text
                </button>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
