import { useState, type ReactNode } from "react";
import { Activity, EyeOff, GitPullRequest, Hash, LayoutDashboard, ListChecks, Radio, Send } from "lucide-react";
import { Segmented } from "../components/Form";
import { CodeRef, ScoreDial } from "../components/Score";
import { StatusIcon, VisibilityTag, type CheckStatus } from "../components/Status";
import { InlineCode } from "../components/InlineCode";
import { MODE_OPTIONS } from "../components/modes";

type Tab = "report" | "checks" | "delivery";

const TABS: { id: Tab; label: string; icon: ReactNode; crumb: string }[] = [
  { id: "report", label: "Report", icon: <Activity />, crumb: "Reports / #1042" },
  { id: "checks", label: "Checks", icon: <ListChecks />, crumb: "Checks & scoring" },
  { id: "delivery", label: "Delivery", icon: <Send />, crumb: "Destinations" },
];

/**
 * The hero image: a framed PRoof window built from the dashboard's real components,
 * with tabs that switch between three screens. All content is an illustrative example.
 */
export function ProductTour() {
  const [tab, setTab] = useState<Tab>("report");
  const current = TABS.find((t) => t.id === tab)!;
  return (
    <div className="tour">
      <div className="tour-window" role="tabpanel" id={`tour-${tab}`} aria-label={`Example: ${current.label}`}>
        <div className="tour-bar">
          <span className="tour-crumb">
            <span className="tour-ws">lumen-labs</span>
            <span className="tour-sep">/</span>
            {current.crumb}
          </span>
          <span className="tour-example">Example data</span>
        </div>
        <div className="tour-body">
          <nav className="tour-side" aria-hidden>
            {[
              [<LayoutDashboard key="o" />, "Overview", false],
              [<Activity key="r" />, "Reports", tab === "report"],
              [<ListChecks key="c" />, "Checks & scoring", tab === "checks"],
              [<Send key="d" />, "Destinations", tab === "delivery"],
            ].map(([icon, label, active]) => (
              <span key={label as string} className={`tour-nav${active ? " is-active" : ""}`}>
                {icon}
                {label}
              </span>
            ))}
          </nav>
          <div className="tour-main">{tab === "report" ? <ReportScreen /> : tab === "checks" ? <ChecksScreen /> : <DeliveryScreen />}</div>
        </div>
      </div>
      <div className="tour-tabs" role="tablist" aria-label="Product tour">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`tour-${t.id}`}
            className={`tour-tab${tab === t.id ? " is-active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const ROWS: { status: CheckStatus; title: string; summary: string; pts: string; ref?: [string, number]; private?: boolean }[] = [
  { status: "pass", title: "Linked issue", summary: "Linked to #981, claimed by the author", pts: "15/15" },
  { status: "warn", title: "Tests", summary: "`upload.ts` changed with no test changes", pts: "5/15", ref: ["src/storage/upload.ts", 31] },
  { status: "fail", title: "Ghost code", summary: "`retryWithJitter` is imported from ./backoff, which doesn't define it", pts: "13/20", ref: ["src/storage/upload.ts", 4], private: true },
  { status: "pass", title: "CI", summary: "All checks passed", pts: "15/15" },
];

function ReportScreen() {
  return (
    <div className="tour-screen">
      <div className="tour-report-head">
        <ScoreDial value={74} size={56} />
        <div>
          <div className="tour-band">Small fixes</div>
          <div className="tour-title">feat(storage): retry uploads with backoff</div>
          <div className="tour-meta">lumen-labs/lumen #1042 · mira-okafor · first contribution here</div>
        </div>
      </div>
      <p className="tour-summary">Adds exponential backoff to failed S3 uploads and a maxAttempts option to the storage config.</p>
      <div className="tour-rows">
        {ROWS.map((r) => (
          <div className="tour-row" key={r.title}>
            <StatusIcon status={r.status} size={18} />
            <div className="tour-row-main">
              <div className="tour-row-title">
                {r.title}
                {r.private && <VisibilityTag visibility="maintainers" />}
              </div>
              <div className="tour-row-text">
                <InlineCode text={r.summary} />
              </div>
              {r.ref && <CodeRef path={r.ref[0]} line={r.ref[1]} />}
            </div>
            <span className="tour-pts">{r.pts}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChecksScreen() {
  const [modes, setModes] = useState<Record<string, "off" | "shadow" | "live">>({ issue: "live", tests: "live", ghost: "shadow", size: "live", spray: "shadow" });
  const rows = [
    ["issue", "Linked issue", "Issue linked and assigned to the author", "15"],
    ["tests", "Tests", "Code changes come with test changes", "15"],
    ["ghost", "Ghost code", "Every called name exists in the repo", "20"],
    ["size", "Size", "Small enough to review carefully", "10"],
  ] as const;
  return (
    <div className="tour-screen">
      <div className="tour-legend">
        <span>
          <EyeOff size={12} /> Shadow: only maintainers see it
        </span>
        <span>
          <Radio size={12} /> Live: shown on the PR
        </span>
      </div>
      <div className="tour-rows">
        {rows.map(([id, title, desc, pts]) => (
          <div className="tour-row tour-row-setting" key={id}>
            <div className="tour-row-main">
              <div className="tour-row-title">{title}</div>
              <div className="tour-row-text">{desc}</div>
            </div>
            <span className="tour-pts">{pts} pts</span>
            <Segmented size="sm" label={`${title} mode`} value={modes[id]!} options={MODE_OPTIONS} onChange={(m) => setModes({ ...modes, [id]: m })} />
          </div>
        ))}
      </div>
    </div>
  );
}

function DeliveryScreen() {
  return (
    <div className="tour-screen tour-delivery">
      <div className="tour-pane">
        <div className="tour-pane-head">
          <GitPullRequest size={13} /> On the PR <VisibilityTag visibility="public" />
        </div>
        <div className="tour-md">
          <strong>PRoof · 78/100 · Small fixes</strong>
          <div className="tour-md-row">
            <StatusIcon status="pass" size={14} /> Linked issue <span>15/15</span>
          </div>
          <div className="tour-md-row">
            <StatusIcon status="warn" size={14} /> Tests <a>How to fix</a> <span>5/15</span>
          </div>
          <div className="tour-md-row">
            <StatusIcon status="pass" size={14} /> CI <span>15/15</span>
          </div>
          <p>Only live checks. Nothing about the person.</p>
        </div>
      </div>
      <div className="tour-pane">
        <div className="tour-pane-head">
          <Hash size={13} /> #pr-triage in Slack <VisibilityTag visibility="maintainers" />
        </div>
        <div className="tour-md">
          <strong>lumen-labs/lumen #1042 · 74/100</strong>
          <div className="tour-md-row">
            <StatusIcon status="fail" size={14} /> Ghost code <code>retryWithJitter</code>
          </div>
          <div className="tour-md-row">
            <StatusIcon status="warn" size={14} /> Spray: 11 PRs to 9 unrelated repos in 2 d
          </div>
          <div className="tour-md-row">
            <StatusIcon status="pass" size={14} /> History: first-time contributor
          </div>
          <p>The full report, shadow checks included.</p>
        </div>
      </div>
    </div>
  );
}
