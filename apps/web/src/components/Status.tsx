import { Check, CircleDashed, Clock, EyeOff, Globe, Minus, Radio, TriangleAlert, X } from "lucide-react";
import type { ReactNode } from "react";
import "./status.css";

export type CheckStatus = "pass" | "warn" | "fail" | "pending" | "na";
export type Mode = "off" | "shadow" | "live";

const STATUS: Record<CheckStatus, { label: string; icon: ReactNode }> = {
  pass: { label: "Pass", icon: <Check strokeWidth={2.6} /> },
  warn: { label: "Check", icon: <TriangleAlert strokeWidth={2.2} /> },
  fail: { label: "Fail", icon: <X strokeWidth={2.6} /> },
  pending: { label: "Running", icon: <Clock strokeWidth={2.2} /> },
  na: { label: "N/A", icon: <Minus strokeWidth={2.4} /> },
};

/** Small round status marker. Shape and colour both carry the meaning, never colour alone. */
export function StatusIcon({ status, size = 18 }: { status: CheckStatus; size?: number }) {
  return (
    <span className={`status-icon s-${status}`} style={{ width: size, height: size }} role="img" aria-label={STATUS[status].label}>
      {STATUS[status].icon}
    </span>
  );
}

export function StatusPill({ status, children }: { status: CheckStatus; children?: ReactNode }) {
  return (
    <span className={`pill s-${status}`}>
      {STATUS[status].icon}
      {children ?? STATUS[status].label}
    </span>
  );
}

/** Who can see a result: everyone on the PR, or only maintainers. */
export function VisibilityTag({ visibility }: { visibility: "public" | "maintainers" }) {
  return visibility === "public" ? (
    <span className="tag" title="Shown on the PR">
      <Globe />
      Public
    </span>
  ) : (
    <span className="tag tag-private" title="Only maintainers see this">
      <EyeOff />
      Maintainers only
    </span>
  );
}

export function ModeTag({ mode }: { mode: Mode }) {
  if (mode === "live")
    return (
      <span className="tag tag-live">
        <Radio />
        Live
      </span>
    );
  if (mode === "shadow")
    return (
      <span className="tag tag-private">
        <EyeOff />
        Shadow
      </span>
    );
  return (
    <span className="tag">
      <CircleDashed />
      Off
    </span>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "private" | CheckStatus }) {
  return <span className={`badge b-${tone}`}>{children}</span>;
}
