import type { Band, Report, ReportItem } from "../report.js";
import type { CheckStatus } from "../types.js";

export interface RenderContext {
  repo: string; // owner/name
  number: number;
  title: string;
  url: string;
  author: string;
  /** Base URL for rule docs, e.g. https://proof.dev/rules. */
  rulesUrl: string;
  /** Link to this report in the dashboard (maintainers only). */
  dashboardUrl?: string;
}

/** Hidden marker so PRoof can find and edit its own comment instead of posting a new one. */
export const CARD_MARKER = "<!-- proof:card -->";

export const BAND_LABEL: Record<Band, string> = {
  ready: "Ready for review",
  "small-fixes": "Small fixes",
  "needs-work": "Needs work",
};

const ICON: Record<CheckStatus, string> = { pass: "✅", warn: "⚠️", fail: "❌", pending: "⏳", na: "➖" };
const SLACK_ICON: Record<CheckStatus, string> = {
  pass: ":white_check_mark:",
  warn: ":warning:",
  fail: ":x:",
  pending: ":hourglass_flowing_sand:",
  na: ":heavy_minus_sign:",
};
const BAND_COLOR: Record<Band, number> = { ready: 0x1f883d, "small-fixes": 0xbf8700, "needs-work": 0xcf222e };

function ruleLink(ctx: RenderContext, item: ReportItem): string | undefined {
  return item.rule ? `${ctx.rulesUrl.replace(/\/$/, "")}/${item.rule}` : undefined;
}

function points(item: ReportItem): string {
  if (item.points === undefined) return item.kind === "context" ? "" : "—";
  return `${trim(item.points)}/${item.weight}`;
}

const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const needsFix = (i: ReportItem) => i.status === "warn" || i.status === "fail";

/**
 * Markdown for the PR comment. Pass a public view of the report: this function
 * renders whatever it is given.
 */
export function renderGithub(report: Report, ctx: RenderContext): string {
  const s = report.fullScore;
  const lines: string[] = [CARD_MARKER];
  lines.push(s ? `### PRoof · ${s.value}/100 · ${BAND_LABEL[s.band]}` : "### PRoof");
  if (report.summary) lines.push("", `> ${report.summary.replace(/\n+/g, " ")}`);
  if (report.newcomer) {
    lines.push("", `Thanks for your contribution, @${ctx.author}! Anything marked ⚠️ or ❌ links to a short guide on how to fix it.`);
  }

  const items = report.items;
  if (items.length) {
    lines.push("", "| | Check | Result | Points |", "|:-:|---|---|--:|");
    for (const i of items) {
      const link = ruleLink(ctx, i);
      const fix = needsFix(i) && link ? ` · [How to fix](${link})` : "";
      lines.push(`| ${ICON[i.status]} | ${cell(i.title)} | ${cell(i.summary)}${fix} | ${points(i)} |`);
    }
  }

  const withEvidence = items.filter((i) => i.evidence.length && i.status !== "pass");
  if (withEvidence.length) {
    lines.push("", "<details><summary>Details</summary>", "");
    for (const i of withEvidence) {
      lines.push(`**${i.title}**`);
      for (const e of i.evidence) {
        const where = e.path ? ` (\`${e.path}${e.line ? `:${e.line}` : ""}\`)` : "";
        lines.push(`- ${e.url ? `[${e.text}](${e.url})` : e.text}${where}`);
      }
      lines.push("");
    }
    lines.push("</details>");
  }

  if (report.pending) lines.push("", "_Some checks are still running. This comment updates itself._");
  lines.push("", "<sub>PRoof never closes or rejects PRs. Maintainers decide. Scores update when you push.</sub>");
  return lines.join("\n");
}

/** Slack Block Kit message for maintainers. */
export function renderSlack(report: Report, ctx: RenderContext) {
  const s = report.fullScore;
  const header = s ? `${s.value}/100 · ${BAND_LABEL[s.band]}` : "Report";
  const blocks: unknown[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: `*<${ctx.url}|${escapeSlack(ctx.title)}>*\n${ctx.repo} #${ctx.number} by ${escapeSlack(ctx.author)}` },
    },
    { type: "section", text: { type: "mrkdwn", text: `*${header}*${report.summary ? `\n${escapeSlack(report.summary)}` : ""}` } },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: report.items
          .map((i) => `${SLACK_ICON[i.status]} *${escapeSlack(i.title)}* ${escapeSlack(i.summary)}${i.points !== undefined ? `  _${points(i)}_` : ""}${i.visibility === "maintainers" ? "  `private`" : ""}`)
          .join("\n")
          .slice(0, 2900),
      },
    },
  ];
  const actions: unknown[] = [{ type: "button", text: { type: "plain_text", text: "Open PR" }, url: ctx.url }];
  if (ctx.dashboardUrl) actions.push({ type: "button", text: { type: "plain_text", text: "Full report" }, url: ctx.dashboardUrl });
  blocks.push({ type: "actions", elements: actions });
  return { text: `${ctx.repo} #${ctx.number}: ${header}`, blocks };
}

const escapeSlack = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Discord webhook payload for maintainers. */
export function renderDiscord(report: Report, ctx: RenderContext) {
  const s = report.fullScore;
  return {
    embeds: [
      {
        title: `${ctx.repo} #${ctx.number}: ${ctx.title}`.slice(0, 256),
        url: ctx.url,
        description: [s ? `**${s.value}/100 · ${BAND_LABEL[s.band]}**` : "", report.summary ?? ""].filter(Boolean).join("\n").slice(0, 4000),
        color: s ? BAND_COLOR[s.band] : 0x6e7781,
        fields: report.items.slice(0, 25).map((i) => ({
          name: `${ICON[i.status]} ${i.title}${i.points !== undefined ? ` · ${points(i)}` : ""}`.slice(0, 256),
          value: (i.summary || "—").slice(0, 1024),
          inline: false,
        })),
        footer: { text: `by ${ctx.author} · PRoof` },
      },
    ],
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Email for maintainers: subject, plain text, and simple HTML with inline styles. */
export function renderEmail(report: Report, ctx: RenderContext) {
  const s = report.fullScore;
  const scoreText = s ? `${s.value}/100 · ${BAND_LABEL[s.band]}` : "Report";
  const subject = `[${ctx.repo}] #${ctx.number} ${ctx.title} · ${scoreText}`;
  const text = [
    `${ctx.repo} #${ctx.number}: ${ctx.title}`,
    `by ${ctx.author} · ${ctx.url}`,
    "",
    scoreText,
    report.summary ?? "",
    "",
    ...report.items.map((i) => `${ICON[i.status]} ${i.title}: ${i.summary}${i.points !== undefined ? ` (${points(i)})` : ""}`),
    "",
    ctx.dashboardUrl ? `Full report: ${ctx.dashboardUrl}` : "",
  ].join("\n");
  const rows = report.items
    .map(
      (i) =>
        `<tr><td style="padding:6px 8px">${ICON[i.status]}</td><td style="padding:6px 8px;font-weight:600">${esc(i.title)}</td>` +
        `<td style="padding:6px 8px;color:#57606a">${esc(i.summary)}</td><td style="padding:6px 8px;text-align:right;font-family:monospace">${points(i)}</td></tr>`,
    )
    .join("");
  const html =
    `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;color:#1f2328;max-width:640px">` +
    `<p style="margin:0 0 4px"><a href="${esc(ctx.url)}" style="color:#0969da;font-weight:600">${esc(ctx.repo)} #${ctx.number}: ${esc(ctx.title)}</a></p>` +
    `<p style="margin:0 0 16px;color:#57606a">by ${esc(ctx.author)}</p>` +
    `<p style="margin:0 0 8px;font-size:18px;font-weight:600">${esc(scoreText)}</p>` +
    (report.summary ? `<p style="margin:0 0 16px">${esc(report.summary)}</p>` : "") +
    `<table style="border-collapse:collapse;width:100%">${rows}</table>` +
    (ctx.dashboardUrl ? `<p style="margin:16px 0 0"><a href="${esc(ctx.dashboardUrl)}" style="color:#0969da">Open the full report</a></p>` : "") +
    `</div>`;
  return { subject, text, html };
}

/** JSON body for an org's webhook. Stable, versioned shape. */
export function renderWebhook(report: Report, ctx: RenderContext) {
  return {
    version: 1,
    pr: { repo: ctx.repo, number: ctx.number, title: ctx.title, url: ctx.url, author: ctx.author },
    score: report.fullScore,
    publicScore: report.publicScore,
    summary: report.summary ?? null,
    pending: report.pending,
    items: report.items.map((i) => ({
      id: i.id,
      title: i.title,
      kind: i.kind,
      status: i.status,
      summary: i.summary,
      points: i.points ?? null,
      weight: i.weight,
      visibility: i.visibility,
      evidence: i.evidence,
    })),
  };
}
