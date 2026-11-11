import { ExternalLink } from "lucide-react";
import "./score.css";

export type Band = "ready" | "small-fixes" | "needs-work";

export const BAND_LABEL: Record<Band, string> = {
  ready: "Ready for review",
  "small-fixes": "Small fixes",
  "needs-work": "Needs work",
};

export function bandOf(value: number): Band {
  return value >= 80 ? "ready" : value >= 60 ? "small-fixes" : "needs-work";
}

/**
 * The readiness score as a ring. The arc length is the score; the colour is the band.
 * Null means nothing was scored yet (all checks pending or not applicable).
 */
export function ScoreDial({ value, size = 56, label = true }: { value: number | null; size?: number; label?: boolean }) {
  const stroke = Math.max(3, Math.round(size / 13));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const band = value === null ? null : bandOf(value);
  return (
    <div className={`dial${band ? ` band-${band}` : " band-none"}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle className="dial-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
        {value !== null && (
          <circle
            className="dial-value"
            cx={size / 2}
            cy={size / 2}
            r={r}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${(c * value) / 100} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      {label && (
        <span className="dial-number tabular" style={{ fontSize: Math.round(size * 0.32) }}>
          {value ?? "–"}
        </span>
      )}
      <span className="visually-hidden">{value === null ? "Not scored yet" : `Score ${value} out of 100, ${BAND_LABEL[band!]}`}</span>
    </div>
  );
}

/** Compact score for tables: number plus a short bar. */
export function ScoreBar({ value }: { value: number | null }) {
  if (value === null) return <span className="score-bar-empty">–</span>;
  const band = bandOf(value);
  return (
    <span className={`score-bar band-${band}`} title={`${value}/100 · ${BAND_LABEL[band]}`}>
      <span className="score-bar-num tabular">{value}</span>
      <span className="score-bar-track">
        <span className="score-bar-fill" style={{ width: `${value}%` }} />
      </span>
    </span>
  );
}

/**
 * A file location as evidence: mono, copyable, and linked to the exact line on GitHub.
 */
export function CodeRef({ path, line, repo, sha }: { path: string; line?: number; repo?: string; sha?: string }) {
  const text = line ? `${path}:${line}` : path;
  if (!repo || !sha) return <code className="coderef">{text}</code>;
  const href = `https://github.com/${repo}/blob/${sha}/${path}${line ? `#L${line}` : ""}`;
  return (
    <a className="coderef coderef-link" href={href} target="_blank" rel="noreferrer" title="Open on GitHub">
      {text}
      <ExternalLink aria-hidden />
    </a>
  );
}
