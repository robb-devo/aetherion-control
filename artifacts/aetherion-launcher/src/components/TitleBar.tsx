export function TitleBar() {
  const bridge = typeof window.aetherion !== "undefined";
  return (
    <header className="titlebar">
      <div className="titlebar-drag" />
      <div className="titlebar-actions">
        <button type="button" aria-label="Minimize" disabled={!bridge} onClick={() => void window.aetherion?.minimize()}>
          <span className="glyph" aria-hidden />
        </button>
        <button type="button" className="close" aria-label="Close" disabled={!bridge} onClick={() => void window.aetherion?.close()}>
          <span className="glyph close-glyph" aria-hidden />
        </button>
      </div>
    </header>
  );
}
