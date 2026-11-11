/** The PRoof mark: a P whose counter closes on a verified dot. */
export function Logo({ size = 22, wordmark = true }: { size?: number; wordmark?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="8" fill="var(--accent)" />
        <path d="M10 9h7.5a5.5 5.5 0 0 1 0 11H14v3.5a1.5 1.5 0 0 1-3 0V10.5A1.5 1.5 0 0 1 12.5 9Zm4 3v5h3.5a2.5 2.5 0 0 0 0-5Z" fill="var(--text-on-accent)" />
        <circle cx="22.5" cy="23" r="2" fill="var(--pass)" />
      </svg>
      {wordmark && (
        <span style={{ fontWeight: 680, fontSize: Math.round(size * 0.72), letterSpacing: "-0.02em" }}>
          PR<span style={{ color: "var(--text-3)", fontWeight: 560 }}>oof</span>
        </span>
      )}
    </span>
  );
}
