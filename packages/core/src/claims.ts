import type { Settings } from "./config.js";

const DAY = 24 * 60 * 60 * 1000;

export type Command = { type: "claim" } | { type: "unclaim" } | { type: "ask"; question: string };

/** Read a PRoof command from a comment. Only the first line counts, so quoting a command elsewhere does nothing. */
export function parseCommand(body: string, botName = "proof"): Command | null {
  const first = body.trim().split("\n")[0]!.trim();
  if (/^\/claim\s*$/i.test(first)) return { type: "claim" };
  if (/^\/unclaim\s*$/i.test(first)) return { type: "unclaim" };
  const ask = new RegExp(`^@${botName}\\s+(.+)`, "is").exec(body.trim());
  if (ask) return { type: "ask", question: ask[1]!.trim() };
  return null;
}

export interface Claim {
  issue: number;
  login: string;
  claimedAt: string;
  /** Last sign of life: the claim itself, a comment by the claimer, or a linked PR update. */
  lastActivityAt: string;
  remindedAt?: string;
}

export type ClaimDecision =
  | { type: "claimed" }
  | { type: "alreadyClaimed"; by: string }
  | { type: "alreadyYours" }
  | { type: "unclaimed" }
  | { type: "nothingToUnclaim" }
  | { type: "issueClosed" };

/** Decide what a /claim or /unclaim comment does. Maintainers can unclaim on anyone's behalf. */
export function decide(
  cmd: Command,
  ctx: { actor: string; active: Claim | null; issueOpen: boolean; actorIsMaintainer: boolean },
): ClaimDecision {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (cmd.type === "claim") {
    if (!ctx.issueOpen) return { type: "issueClosed" };
    if (!ctx.active) return { type: "claimed" };
    return same(ctx.active.login, ctx.actor) ? { type: "alreadyYours" } : { type: "alreadyClaimed", by: ctx.active.login };
  }
  if (cmd.type === "unclaim") {
    if (!ctx.active) return { type: "nothingToUnclaim" };
    if (same(ctx.active.login, ctx.actor) || ctx.actorIsMaintainer) return { type: "unclaimed" };
    return { type: "alreadyClaimed", by: ctx.active.login };
  }
  throw new Error("decide() only handles claim and unclaim");
}

export type SweepAction = { claim: Claim; action: "remind" | "release" };

/** Find claims that need a reminder or should be released. Run on a schedule. */
export function sweep(claims: Claim[], settings: Settings, now: string): SweepAction[] {
  const t = Date.parse(now);
  const out: SweepAction[] = [];
  for (const c of claims) {
    const idle = t - Date.parse(c.lastActivityAt);
    if (idle >= settings.claims.releaseAfterDays * DAY) {
      out.push({ claim: c, action: "release" });
    } else if (idle >= settings.claims.remindAfterDays * DAY) {
      const remindedSinceActivity = c.remindedAt && Date.parse(c.remindedAt) >= Date.parse(c.lastActivityAt);
      if (!remindedSinceActivity) out.push({ claim: c, action: "remind" });
    }
  }
  return out;
}

/** Comment text for each outcome. Friendly, short, and always says what to do next. */
export function claimMessage(
  d: ClaimDecision | { type: "remind" | "release" },
  ctx: { login: string; settings: Settings },
): string | null {
  const { remindAfterDays, releaseAfterDays } = ctx.settings.claims;
  switch (d.type) {
    case "claimed":
      return `@${ctx.login} this issue is yours. If there's no activity for ${releaseAfterDays} days it will be released for someone else. Comment \`/unclaim\` if you change your mind.`;
    case "alreadyClaimed":
      return `@${ctx.login} this issue is already claimed by @${d.by}. You can pick another issue, or ask here if they still need help.`;
    case "alreadyYours":
      return null;
    case "unclaimed":
      return `This issue is open for anyone to claim again. Comment \`/claim\` to take it.`;
    case "nothingToUnclaim":
      return null;
    case "issueClosed":
      return `@${ctx.login} this issue is closed, so it can't be claimed.`;
    case "remind":
      return `@${ctx.login} checking in: it's been ${remindAfterDays} days without activity on this claim. Are you still working on it? Any comment or PR update keeps it yours.`;
    case "release":
      return `@${ctx.login} this claim was released after ${releaseAfterDays} days without activity. Thanks for your interest, and feel free to \`/claim\` it again if you pick it back up.`;
  }
}
