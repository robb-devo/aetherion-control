import { useEffect, useMemo, useState } from "react";
import type { SandboxCreateInput, SandboxOptions, SandboxServer, Settings } from "../vite-env";

type Preset = "light" | "balanced" | "performance" | "max" | "custom";

function messageOf(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

export function ServerView({
  signedIn,
  launchBusy,
  onLogin,
  onSettings,
  onPlay,
}: {
  signedIn: boolean;
  launchBusy: boolean;
  onLogin: () => void;
  onSettings: (next: Settings) => void;
  onPlay: () => Promise<void>;
}) {
  const [options, setOptions] = useState<SandboxOptions | null>(null);
  const [servers, setServers] = useState<SandboxServer[]>([]);
  const [name, setName] = useState("");
  const [serverType, setServerType] = useState("paper");
  const [version, setVersion] = useState("");
  const [preset, setPreset] = useState<Preset>("balanced");
  const [ramGb, setRamGb] = useState(4);
  const [cpuCores, setCpuCores] = useState(2);
  const [maxPlayers, setMaxPlayers] = useState(12);
  const [viewDistance, setViewDistance] = useState(8);
  const [simulationDistance, setSimulationDistance] = useState(6);
  const [difficulty, setDifficulty] = useState("normal");
  const [gamemode, setGamemode] = useState("survival");
  const [onlineMode, setOnlineMode] = useState(true);
  const [motd, setMotd] = useState("AETHERION Sandbox");
  const [startAfterCreate, setStartAfterCreate] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploadFor, setUploadFor] = useState<string | null>(null);
  const [uploadPath, setUploadPath] = useState("server.properties");
  const [uploadBody, setUploadBody] = useState("");

  const versions = options?.versions?.[serverType] ?? [];
  const selectedVersion = useMemo(() => {
    if (version && versions.includes(version)) return version;
    return versions.find((item) => item.startsWith("1.21")) ?? versions[0] ?? "";
  }, [version, versions]);

  async function load() {
    if (!window.aetherion || !signedIn) return;
    setLoading(true);
    setError(null);
    try {
      const [nextOptions, list] = await Promise.all([
        window.aetherion.sandboxOptions(),
        window.aetherion.sandboxList(),
      ]);
      setOptions(nextOptions);
      setServers(list.servers);
      if (nextOptions.defaults) {
        setMaxPlayers((current) => current || nextOptions.defaults.maxPlayers);
      }
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!signedIn) {
      setOptions(null);
      setServers([]);
      return;
    }
    void load();
  }, [signedIn]);

  function applyPreset(next: Preset) {
    setPreset(next);
    if (next === "custom" || !options) return;
    const found = options.presets.find((item) => item.value === next);
    if (!found) return;
    setRamGb(found.ramGb);
    setCpuCores(found.cpuCores);
  }

  const canCreate = Boolean(
    signedIn &&
      !busy &&
      options &&
      name.trim().length >= 2 &&
      selectedVersion &&
      ramGb <= options.remainingRamGb &&
      cpuCores <= options.remainingCores,
  );

  async function create() {
    if (!window.aetherion || !canCreate) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const input: SandboxCreateInput = {
      name: name.trim(),
      serverType,
      version: selectedVersion,
      ramGb,
      cpuCores,
      preset,
      maxPlayers,
      viewDistance,
      simulationDistance,
      difficulty,
      gamemode,
      onlineMode,
      motd,
      startAfterCreate,
    };
    try {
      const created = await window.aetherion.sandboxCreate(input);
      setNotice(`Ready · ${created.address}`);
      setName("");
      await load();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function start(server: SandboxServer) {
    if (!window.aetherion) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await window.aetherion.sandboxStart(server.id);
      setNotice(result.running ? `Online · ${result.address}` : `Start queued · ${result.address}`);
      await load();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(server: SandboxServer) {
    if (!window.aetherion) return;
    if (!window.confirm(`Delete ${server.name}? This removes the world.`)) return;
    setBusy(true);
    setError(null);
    try {
      await window.aetherion.sandboxDelete(server.id);
      await load();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function play(server: SandboxServer) {
    if (!window.aetherion) return;
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
    }
  }

  async function upload(server: SandboxServer) {
    if (!window.aetherion) return;
    setBusy(true);
    setError(null);
    try {
      await window.aetherion.sandboxUpload({ id: server.id, path: uploadPath.trim(), content: uploadBody });
      setNotice(`Uploaded ${uploadPath.trim()}`);
      setUploadBody("");
      setUploadFor(null);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page servers-page">
      <header className="page-head">
        <p className="eyebrow">Sandbox Factory</p>
        <h1>Your servers</h1>
        <p className="lede">A private world on its own port. Friends join with the address shown after it is created.</p>
      </header>

      {!signedIn ? (
        <section className="card gate">
          <h2>Sign in to create a sandbox</h2>
          <p className="hint">Your servers stay on this Microsoft account.</p>
          <button type="button" className="play-btn" onClick={onLogin}>Sign in with Microsoft</button>
        </section>
      ) : null}

      {signedIn && loading && !options ? <p className="hint">Loading your sandboxes…</p> : null}

      {signedIn && options ? (
        <>
          <div className="meters">
            <Meter label="RAM pool" used={options.usedRamGb} total={options.poolGb} />
            <Meter label="CPU pool" used={options.usedCores} total={options.poolCores} />
          </div>

          <section className="card">
            <h2>Create</h2>
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="friends / event / test" spellCheck={false} />
            </label>

            <p className="field-label">Engine</p>
            <div className="engine-grid">
              {options.serverTypes.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={`engine ${serverType === item.value ? "on" : ""}`}
                  onClick={() => setServerType(item.value)}
                >
                  <strong>{item.label}</strong>
                  <span>{item.blurb}</span>
                </button>
              ))}
            </div>

            <p className="field-label">Version</p>
            <div className="chips">
              {versions.slice(0, 16).map((item) => (
                <button key={item} type="button" className={selectedVersion === item ? "on" : ""} onClick={() => setVersion(item)}>
                  {item}
                </button>
              ))}
            </div>

            <p className="field-label">Resources</p>
            <div className="chips">
              {options.presets.map((item) => (
                <button key={item.value} type="button" className={preset === item.value ? "on" : ""} onClick={() => applyPreset(item.value)}>
                  {item.label}
                </button>
              ))}
              <button type="button" className={preset === "custom" ? "on" : ""} onClick={() => applyPreset("custom")}>Custom</button>
            </div>
            {preset !== "custom" ? (
              <p className="hint">{options.presets.find((item) => item.value === preset)?.blurb} · {ramGb} GB · {cpuCores} cores</p>
            ) : null}

            <p className="field-label">RAM ({ramGb} GB)</p>
            <div className="chips">
              {(options.ramChoices ?? []).map((item) => (
                <button key={item} type="button" className={ramGb === item ? "on" : ""} onClick={() => { setPreset("custom"); setRamGb(item); }}>
                  {item}
                </button>
              ))}
            </div>

            <p className="field-label">CPU cores ({cpuCores})</p>
            <div className="chips">
              {(options.cpuChoices ?? []).map((item) => (
                <button key={item} type="button" className={cpuCores === item ? "on" : ""} onClick={() => { setPreset("custom"); setCpuCores(item); }}>
                  {item}
                </button>
              ))}
            </div>

            <button type="button" className="advanced-toggle" onClick={() => setShowAdvanced((open) => !open)}>
              <span>World & network</span>
              <span>{showAdvanced ? "Hide" : "Show"}</span>
            </button>

            {showAdvanced ? (
              <div className="advanced-body">
                <Choice label={`Players (${maxPlayers})`} values={[6, 8, 12, 16, 20, 30]} current={maxPlayers} onPick={setMaxPlayers} />
                <Choice label={`View distance (${viewDistance})`} values={[6, 8, 10, 12]} current={viewDistance} onPick={setViewDistance} />
                <Choice label={`Simulation (${simulationDistance})`} values={[4, 6, 8, 10]} current={simulationDistance} onPick={setSimulationDistance} />
                <p className="field-label">Difficulty</p>
                <div className="chips">
                  {options.difficulties.map((item) => (
                    <button key={item} type="button" className={difficulty === item ? "on" : ""} onClick={() => setDifficulty(item)}>{item}</button>
                  ))}
                </div>
                <p className="field-label">Gamemode</p>
                <div className="chips">
                  {options.gamemodes.map((item) => (
                    <button key={item} type="button" className={gamemode === item ? "on" : ""} onClick={() => setGamemode(item)}>{item}</button>
                  ))}
                </div>
                <label>
                  MOTD
                  <input value={motd} onChange={(e) => setMotd(e.target.value)} />
                </label>
                <button type="button" className="toggle" onClick={() => setOnlineMode((value) => !value)}>
                  <span><strong>Online mode</strong><em>Off lets offline friends join</em></span>
                  <span className={`toggle-switch ${onlineMode ? "on" : ""}`}><span /></span>
                </button>
                <button type="button" className="toggle" onClick={() => setStartAfterCreate((value) => !value)}>
                  <span><strong>Start after create</strong><em>Boot when the install finishes</em></span>
                  <span className={`toggle-switch ${startAfterCreate ? "on" : ""}`}><span /></span>
                </button>
              </div>
            ) : null}

            <p className="preview">
              Join preview · {options.publicIp}:256xx · {ramGb}G / {cpuCores}C · {serverType} {selectedVersion || "…"}
            </p>

            <button type="button" className="play-btn" disabled={!canCreate} onClick={() => void create()}>
              {busy ? "Working…" : "Create sandbox"}
            </button>
          </section>
        </>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}
      {notice ? <p className="form-notice">{notice}</p> : null}

      {signedIn ? (
        <section className="fleet">
          <h2>Active sandboxes</h2>
          {servers.length === 0 && !loading ? <p className="hint">No sandboxes on this account yet.</p> : null}
          <ul>
            {servers.map((server) => (
              <li key={server.id}>
                <div>
                  <strong>{server.name}</strong>
                  <span>{server.serverType} {server.version} · {server.ramGb}G / {server.cpuCores}C</span>
                  <em>{server.address}</em>
                </div>
                <div className="row-actions">
                  <button type="button" disabled={busy} onClick={() => void start(server)}>Start</button>
                  <button type="button" disabled={busy || launchBusy} onClick={() => void play(server)}>Play</button>
                  <button type="button" disabled={busy} onClick={() => setUploadFor(uploadFor === server.id ? null : server.id)}>File</button>
                  <button type="button" className="danger" disabled={busy} onClick={() => void remove(server)}>Delete</button>
                </div>
                {uploadFor === server.id ? (
                  <div className="upload">
                    <input value={uploadPath} onChange={(e) => setUploadPath(e.target.value)} aria-label="File path" spellCheck={false} />
                    <textarea value={uploadBody} onChange={(e) => setUploadBody(e.target.value)} placeholder="Text only, 256 KB" />
                    <button type="button" disabled={busy || !uploadBody} onClick={() => void upload(server)}>Upload</button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Meter({ label, used, total }: { label: string; used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return (
    <div className="meter">
      <div>
        <span>{label}</span>
        <strong>{used}/{total}</strong>
      </div>
      <div className="meter-track"><span style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function Choice({
  label,
  values,
  current,
  onPick,
}: {
  label: string;
  values: number[];
  current: number;
  onPick: (value: number) => void;
}) {
  return (
    <>
      <p className="field-label">{label}</p>
      <div className="chips">
        {values.map((item) => (
          <button key={item} type="button" className={current === item ? "on" : ""} onClick={() => onPick(item)}>{item}</button>
        ))}
      </div>
    </>
  );
}
