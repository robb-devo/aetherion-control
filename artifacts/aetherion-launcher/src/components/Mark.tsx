export function AetherionMark({ size = 46 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className="brand-svg" aria-hidden>
      <defs>
        <radialGradient id="ae-glow" cx="50%" cy="42%" r="58%">
          <stop offset="0%" stopColor="#e0c48a" stopOpacity="0.34" />
          <stop offset="55%" stopColor="#b89ad8" stopOpacity="0.1" />
          <stop offset="100%" stopColor="#e0c48a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="30" fill="url(#ae-glow)" />
      <circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" strokeWidth="1.1" opacity="0.85" />
      <circle cx="32" cy="32" r="21.5" fill="none" stroke="#b89ad8" strokeWidth="0.6" opacity="0.65" />
      <g stroke="currentColor" strokeWidth="1" opacity="0.45">
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
