import type { Check, CheckResult, Evidence } from "../types.js";

const DAY = 24 * 60 * 60 * 1000;
const VERDICT_RATIO = { good: 1, partial: 0.5, off: 0 } as const;

/** A7 · Understanding questions */
export const questionsCheck: Check = {
  id: "questions",
  title: "Questions",
  kind: "scored",
  weight: (s) => s.weights.questions,
  // Questions are posted on the PR itself, so when enabled they are always public.
  mode: (s) => (s.questions.mode === "off" ? "off" : "live"),
  run({ pr, settings }): CheckResult {
    const base = { id: "questions", title: "Questions", kind: "scored" as const, rule: "questions" };
    const qs = pr.questions ?? [];
    if (qs.length === 0) {
      return { ...base, status: "pending", summary: "Questions will be posted on changed lines", evidence: [] };
    }

    const now = Date.parse(pr.now);
    const graceMs = settings.questions.graceDays * DAY;
    const answered = qs.filter((q) => q.answer);
    const overdue = qs.filter((q) => !q.answer && now - Date.parse(q.askedAt) > graceMs);
    const waiting = qs.length - answered.length - overdue.length;

    const evidence: Evidence[] = qs.map((q) => {
      const where = { path: q.path, line: q.line };
      if (!q.answer) return { ...where, text: `Q: ${q.question} — no answer yet` };
      if (!q.review) return { ...where, text: `Q: ${q.question} — A: ${q.answer}` };
      return { ...where, text: `Q: ${q.question} — ${q.review.verdict}: ${q.review.reason}` };
    });

    const summary = `${answered.length} of ${qs.length} answered`;
    if (waiting > 0) return { ...base, status: "pending", summary: `${summary}, waiting on the author`, evidence };

    // In askOnly mode the maintainer judges the answers, so the check carries no score.
    if (settings.questions.mode === "askOnly") {
      return { ...base, status: overdue.length ? "warn" : "pass", summary, evidence };
    }

    const reviewed = answered.filter((q) => q.review);
    if (reviewed.length < answered.length) {
      return { ...base, status: "pending", summary: `${summary}, review in progress`, evidence };
    }
    const total = reviewed.reduce((n, q) => n + VERDICT_RATIO[q.review!.verdict], 0);
    const ratio = Math.round((total / qs.length) * 100) / 100;
    return { ...base, status: ratio >= 0.75 ? "pass" : ratio >= 0.4 ? "warn" : "fail", ratio, summary, evidence };
  },
};
