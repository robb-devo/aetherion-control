import type { UpdateStatus } from "../vite-env";

export function TitleBar({
  version,
  update,
  busy,
  onUpdate,
}: {
  version: string;
  update: UpdateStatus | null;
  busy: boolean;
  onUpdate: () => void;
}) {
  const bridge = typeof window.aetherion !== "undefined";
  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <span>AETHERION</span>
        <span className="titlebar-version">v{version}</span>
      </div>
      <div className="titlebar-actions">
        {update?.available && update.version ? (
          <button
            type="button"
            className="update-chip"
            disabled={busy}
            onClick={onUpdate}
          >
            Update {update.version}
          </button>
        ) : null}
        <button
          type="button"
          aria-label="Minimize"
          disabled={!bridge}
          onClick={() => void window.aetherion?.minimize()}
        >
          <span className="glyph" aria-hidden />
        </button>
        <button
          type="button"
          className="close"
          aria-label="Close"
          disabled={!bridge}
          onClick={() => void window.aetherion?.close()}
        >
          <span className="glyph close-glyph" aria-hidden />
        </button>
      </div>
    </header>
  );
}
