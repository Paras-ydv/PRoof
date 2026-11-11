import { Link, useSearchParams } from "react-router";
import { ArrowRight, Check, Inbox } from "lucide-react";
import { useAccuracy, useLogin, useReports, useWorkspace, timeAgo } from "../lib/hooks";
import { ButtonLink } from "../components/Button";
import { Callout, EmptyState, PageHeader, Panel, Skeleton, Stat } from "../components/Layout";
import { ScoreBar, ScoreDial } from "../components/Score";
import { Badge } from "../components/Status";
import { CHECK_NAMES } from "../lib/checks";
import "../components/table.css";
import "./pages.css";

export function Overview() {
  const login = useLogin();
  const [params] = useSearchParams();
  const ws = useWorkspace();
  const reports = useReports();
  const accuracy = useAccuracy();

  if (ws.isLoading) return <OverviewSkeleton />;
  if (ws.error || !ws.data) return <Callout tone="fail" title="Couldn't load this workspace">{ws.error?.message}</Callout>;

  const { workspace, repos, destinations, stats } = ws.data;
  const eff = workspace.effective;
  const anyLive = Object.values(eff.checks).some((m) => m === "live");
  const steps = [
    { done: true, title: "Install PRoof on GitHub", desc: `${repos.filter((r) => r.enabled).length} repositories connected`, to: `/w/${login}/repos` },
    { done: !!workspace.ai, title: "Choose an AI model", desc: "Needed for PR summaries and understanding questions. Checks work without it.", to: `/w/${login}/ai` },
    { done: destinations.some((d) => d.type !== "github"), title: "Send reports to your team", desc: "Slack, Discord, email or a webhook. Maintainers see the full report there.", to: `/w/${login}/destinations` },
    { done: anyLive, title: "Go live on the PR", desc: "Everything starts in shadow mode. Turn a check live when you trust it.", to: `/w/${login}/checks` },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const totalFeedback = (accuracy.data?.checks ?? []).reduce((n, c) => n + c.correct + c.falseFlag, 0);
  const falseFlags = (accuracy.data?.checks ?? []).reduce((n, c) => n + c.falseFlag, 0);
  const recent = (reports.data?.reports ?? []).slice(0, 6);

  return (
    <div className="stack">
      {params.get("welcome") && (
        <Callout tone="pass" title={`PRoof is installed on ${workspace.login}`}>
          Every check starts in shadow mode, so contributors won't see anything until you turn a check live.
        </Callout>
      )}
      <PageHeader title="Overview" description={`What PRoof saw across ${repos.filter((r) => r.enabled).length} repositories in the last 30 days.`} />

      <div className="stats">
        <Stat label="PRs triaged" value={stats.last30Days.prs} sub={`${stats.last30Days.reports} reports incl. re-runs`} />
        <Stat
          label="Average score"
          value={
            <span className="row" style={{ gap: 10 }}>
              {stats.last30Days.avgScore ?? "–"}
              {stats.last30Days.avgScore !== null && <ScoreDial value={stats.last30Days.avgScore} size={26} label={false} />}
            </span>
          }
          sub="Across all enabled checks"
        />
        <Stat
          label="Flag accuracy"
          value={totalFeedback ? `${Math.round(((totalFeedback - falseFlags) / totalFeedback) * 100)}%` : "–"}
          sub={totalFeedback ? `${falseFlags} false flags in ${totalFeedback} reviews` : "Mark flags on a report to measure this"}
        />
        <Stat label="Live checks" value={Object.values(eff.checks).filter((m) => m === "live").length} sub={`${Object.values(eff.checks).filter((m) => m === "shadow").length} in shadow mode`} />
      </div>

      {doneCount < steps.length && (
        <Panel
          title="Finish setting up"
          description={`${doneCount} of ${steps.length} done`}
          actions={
            <div className="progress" style={{ width: 120 }}>
              <span style={{ width: `${(doneCount / steps.length) * 100}%` }} />
            </div>
          }
          flush
        >
          <div className="checklist">
            {steps.map((s) => (
              <div key={s.title} className={`checklist-item${s.done ? " is-done" : ""}`}>
                <span className="checklist-mark">{s.done && <Check strokeWidth={3} />}</span>
                <div>
                  <div className="checklist-title">{s.title}</div>
                  <div className="checklist-desc">{s.desc}</div>
                </div>
                {!s.done && (
                  <ButtonLink to={s.to} size="sm" trailing={<ArrowRight />}>
                    Set up
                  </ButtonLink>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}

      <div className="grid-main-side">
        <Panel
          title="Latest reports"
          actions={
            <ButtonLink to={`/w/${login}/reports`} size="sm" variant="ghost" trailing={<ArrowRight />}>
              All reports
            </ButtonLink>
          }
          flush
        >
          {reports.isLoading ? (
            <div className="stack-sm" style={{ padding: 18 }}>
              <Skeleton height={28} />
              <Skeleton height={28} />
              <Skeleton height={28} />
            </div>
          ) : recent.length === 0 ? (
            <EmptyState icon={<Inbox />} title="No PRs yet">
              Reports appear here when someone opens or updates a pull request in a connected repository.
            </EmptyState>
          ) : (
            <table className="table">
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id} className="table-link-row">
                    <td style={{ width: "100%" }}>
                      <Link to={`/w/${login}/reports/${r.id}`} className="cell-title">
                        <span className="cell-title-main">{r.title}</span>
                        <span className="cell-title-sub">
                          {r.repo} #{r.prNumber} · {r.author} · {timeAgo(r.updatedAt)}
                        </span>
                      </Link>
                    </td>
                    <td>{r.flags > 0 ? <Badge tone="warn">{r.flags} flags</Badge> : <Badge tone="pass">Clean</Badge>}</td>
                    <td>
                      <ScoreBar value={r.scoreFull} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Flag accuracy" description="From maintainers marking flags as correct or false, last 90 days.">
          {(accuracy.data?.checks ?? []).length === 0 ? (
            <p className="muted small">No feedback yet. On any report, mark a flag as correct or false to start measuring.</p>
          ) : (
            <div className="stack-sm">
              {accuracy.data!.checks.map((c) => {
                const total = c.correct + c.falseFlag;
                return (
                  <div className="meter" key={c.checkId}>
                    <div className="meter-head">
                      <span>{CHECK_NAMES[c.checkId] ?? c.checkId}</span>
                      <span className="muted tabular">
                        {c.falseFlag} false of {total}
                      </span>
                    </div>
                    <div className="meter-track">
                      <span className="meter-pass" style={{ width: `${(c.correct / total) * 100}%` }} />
                      <span className="meter-fail" style={{ width: `${(c.falseFlag / total) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="stack">
      <Skeleton width={160} height={24} />
      <Skeleton height={86} radius={11} />
      <Skeleton height={220} radius={11} />
    </div>
  );
}
