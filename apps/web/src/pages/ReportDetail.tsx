import { useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, BookOpen, Check, Clock, GitCommitHorizontal, GitPullRequest, User, X } from "lucide-react";
import { api } from "../api/client";
import type { ReportDetail as Detail, ReportItem } from "../api/types";
import { timeAgo, useLogin, useMeta, useReport } from "../lib/hooks";
import { ButtonLink } from "../components/Button";
import { Segmented } from "../components/Form";
import { Callout, PageHeader, Panel, Skeleton, useToast } from "../components/Layout";
import { BAND_LABEL, CodeRef, ScoreDial, type Band } from "../components/Score";
import { StatusIcon, StatusPill, VisibilityTag } from "../components/Status";
import { CHECK_NAMES } from "../lib/checks";
import { InlineCode } from "../components/InlineCode";
import "./pages.css";

type View = "maintainer" | "contributor";

export function ReportDetail() {
  const login = useLogin();
  const { id = "" } = useParams();
  const { data, isLoading, error } = useReport(id);
  const [view, setView] = useState<View>("maintainer");

  if (isLoading)
    return (
      <div className="stack">
        <Skeleton width={120} height={14} />
        <Skeleton height={120} radius={11} />
        <Skeleton height={320} radius={11} />
      </div>
    );
  if (error || !data) return <Callout tone="fail" title="Couldn't load this report">{error?.message}</Callout>;

  const r = data.report;
  const rep = r.data;
  const items = view === "maintainer" ? rep.items : rep.items.filter((i) => i.visibility === "public");
  const score = view === "maintainer" ? rep.fullScore : rep.publicScore;
  const scored = items.filter((i) => i.kind === "scored");
  const context = items.filter((i) => i.kind === "context");
  const hidden = rep.items.length - rep.items.filter((i) => i.visibility === "public").length;

  return (
    <div className="stack">
      <PageHeader
        eyebrow={
          <Link to={`/w/${login}/reports`} className="row" style={{ gap: 4, color: "inherit" }}>
            <ArrowLeft size={13} /> Reports
          </Link>
        }
        title={<span className="visually-hidden">Report for {r.title}</span>}
        actions={
          <>
            <Segmented<View>
              label="Whose view"
              value={view}
              onChange={setView}
              options={[
                { value: "maintainer", label: "Full report" },
                { value: "contributor", label: "What the author sees" },
              ]}
            />
            <ButtonLink to={r.url} variant="primary" icon={<GitPullRequest />} trailing={<ArrowUpRight />}>
              View on GitHub
            </ButtonLink>
          </>
        }
      />

      <section className="panel">
        <div className="report-head">
          <ScoreDial value={score?.value ?? null} size={72} />
          <div className="report-head-text">
            <div className="row">
              {score ? <StatusPill status={score.band === "ready" ? "pass" : score.band === "small-fixes" ? "warn" : "fail"}>{BAND_LABEL[score.band as Band]}</StatusPill> : <StatusPill status="na">Not scored</StatusPill>}
              {rep.pending && <StatusPill status="pending">Some checks still running</StatusPill>}
            </div>
            <h2 className="report-title">{r.title}</h2>
            <div className="report-meta">
              <a className="report-meta-link mono" href={r.url} target="_blank" rel="noreferrer" title="Open the pull request on GitHub">
                {r.repo} #{r.prNumber}
              </a>
              <span>
                <a className="report-meta-link" href={`https://github.com/${r.author}`} target="_blank" rel="noreferrer" title="Author's GitHub profile">
                  <User /> {r.author}
                </a>
                {rep.newcomer && " · first contribution here"}
              </span>
              <a
                className="report-meta-link mono"
                href={`${r.url}/commits/${r.headSha}`}
                target="_blank"
                rel="noreferrer"
                title="The commit this report is for"
              >
                <GitCommitHorizontal /> {r.headSha.slice(0, 7)}
              </a>
              <span>
                <Clock /> updated {timeAgo(r.updatedAt)}
              </span>
            </div>
          </div>
        </div>
        {rep.summary && (
          <div className="report-summary">
            <span className="report-summary-label">SUMMARY</span>
            {rep.summary}
          </div>
        )}
      </section>

      {view === "contributor" && (
        <Callout tone="private" title="This is what appears on the PR">
          {hidden > 0
            ? `${hidden} result${hidden === 1 ? " is" : "s are"} hidden from the author: shadow-mode checks and anything about the person.`
            : "Every result in this report is public."}
        </Callout>
      )}

      <div className="grid-main-side">
        <div className="stack">
          <Panel title="Checks" description={score ? `Checks that apply to this PR are worth ${score.counted} points, scaled to a score out of 100.` : undefined} flush>
            <CheckList items={scored} data={data} canFeedback={view === "maintainer"} />
          </Panel>
          {context.length > 0 && (
            <Panel title="About the contributor" description="Evidence for maintainers. It never affects the score and is never shown on the PR." flush>
              <CheckList items={context} data={data} canFeedback />
            </Panel>
          )}
        </div>

        <div className="stack">
          <Panel title="Delivered to">
            {data.deliveries.length === 0 ? (
              <p className="muted small">Not sent anywhere yet. Private destinations get the report once CI finishes.</p>
            ) : (
              <div className="stack-sm">
                {data.deliveries.map((d, i) => (
                  <div key={i} className="row" style={{ justifyContent: "space-between" }}>
                    <span className="row" style={{ gap: 6 }}>
                      <StatusIcon status={d.status === "sent" ? "pass" : "fail"} size={16} />
                      {d.type === "github" ? "PR comment" : d.type[0]!.toUpperCase() + d.type.slice(1)}
                    </span>
                    <span className="muted small">{d.status === "sent" ? timeAgo(d.at) : d.error}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          <Panel title="How this was scored">
            <p className="muted small">
              Settings are saved with every report, so this score can always be explained later, even after the rules change.
            </p>
            <div className="stack-sm" style={{ marginTop: 12 }}>
              {Object.entries(r.settings.weights).map(([k, w]) => (
                <div key={k} className="row small" style={{ justifyContent: "space-between" }}>
                  <span className="muted">{CHECK_NAMES[k] ?? k}</span>
                  <span className="tabular">{w} pts</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function CheckList({ items, data, canFeedback }: { items: ReportItem[]; data: Detail; canFeedback: boolean }) {
  if (items.length === 0) return <p className="muted small" style={{ padding: 18 }}>Nothing to show in this view.</p>;
  return (
    <div className="check-list">
      {items.map((i) => (
        <CheckRow key={i.id} item={i} data={data} canFeedback={canFeedback} />
      ))}
    </div>
  );
}

function CheckRow({ item, data, canFeedback }: { item: ReportItem; data: Detail; canFeedback: boolean }) {
  const login = useLogin();
  const qc = useQueryClient();
  const toast = useToast();
  const rulesUrl = useMeta().data?.rulesUrl;
  const mine = data.feedback.find((f) => f.mine && f.checkId === item.id);
  const others = data.feedback.filter((f) => !f.mine && f.checkId === item.id);
  const flagged = item.status === "warn" || item.status === "fail";
  const send = useMutation({
    mutationFn: (verdict: "correct" | "false-flag") => api(`/workspaces/${login}/reports/${data.report.id}/feedback`, { method: "POST", body: { checkId: item.id, verdict } }),
    onSuccess: (_d, verdict) => {
      qc.invalidateQueries({ queryKey: ["report", login, data.report.id] });
      qc.invalidateQueries({ queryKey: ["accuracy", login] });
      toast("pass", verdict === "false-flag" ? "Marked as a false flag. Thanks, this tunes the check." : "Marked as correct");
    },
  });

  return (
    <div className="check-row">
      <StatusIcon status={item.status} />
      <div className="check-row-main">
        <div className="check-row-title">
          {item.title}
          <VisibilityTag visibility={item.visibility} />
        </div>
        <div className="check-row-summary">
          <InlineCode text={item.summary} />
        </div>
        {item.evidence.length > 0 && (
          <ul className="evidence">
            {item.evidence.map((e, n) => (
              <li key={n}>
                {e.path && <CodeRef path={e.path} line={e.line} repo={data.report.repo} sha={data.report.headSha} />}
                {e.url ? (
                  <a href={e.url} target="_blank" rel="noreferrer">
                    <InlineCode text={e.text} />
                  </a>
                ) : (
                  <span>
                    <InlineCode text={e.text} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {(flagged || item.rule) && (
          <div className="check-row-foot">
            {flagged && item.rule && rulesUrl && !item.rule.startsWith("custom/") && (
              <a href={`${rulesUrl}/${item.rule}.md`} target="_blank" rel="noreferrer">
                <BookOpen /> How to fix
              </a>
            )}
            {others.length > 0 && (
              <span className="muted">
                {others.filter((o) => o.verdict === "false-flag").length > 0 ? "Another maintainer marked this a false flag" : "Another maintainer confirmed this"}
              </span>
            )}
            {canFeedback && flagged && (
              <span className="feedback-buttons">
                <button type="button" className="feedback-btn is-correct" aria-pressed={mine?.verdict === "correct"} disabled={send.isPending} onClick={() => send.mutate("correct")}>
                  <Check /> Correct
                </button>
                <button type="button" className="feedback-btn is-false" aria-pressed={mine?.verdict === "false-flag"} disabled={send.isPending} onClick={() => send.mutate("false-flag")}>
                  <X /> False flag
                </button>
              </span>
            )}
          </div>
        )}
      </div>
      <div className="check-row-points">
        {item.points !== undefined ? (
          <>
            <strong>{Number.isInteger(item.points) ? item.points : item.points.toFixed(1)}</strong> / {item.weight}
          </>
        ) : item.kind === "scored" && item.status !== "na" ? (
          "—"
        ) : null}
      </div>
    </div>
  );
}
