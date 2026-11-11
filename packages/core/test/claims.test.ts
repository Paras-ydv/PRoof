import { describe, expect, it } from "vitest";
import { claimMessage, decide, parseCommand, sweep, type Claim } from "../src/claims.js";
import { resolveSettings } from "../src/config.js";

describe("parseCommand", () => {
  it("reads commands from the first line only", () => {
    expect(parseCommand("/claim")).toEqual({ type: "claim" });
    expect(parseCommand("  /UNCLAIM \n thanks")).toEqual({ type: "unclaim" });
    expect(parseCommand("I said /claim earlier")).toBeNull();
    expect(parseCommand("> /claim")).toBeNull();
    expect(parseCommand("/claimed")).toBeNull();
  });

  it("reads @proof questions", () => {
    expect(parseCommand("@proof what does this PR change?")).toEqual({ type: "ask", question: "what does this PR change?" });
  });
});

describe("decide", () => {
  const active: Claim = { issue: 4, login: "sam", claimedAt: "2026-11-01T00:00:00Z", lastActivityAt: "2026-11-01T00:00:00Z" };
  const base = { actor: "dana", active: null, issueOpen: true, actorIsMaintainer: false };

  it("claims a free open issue", () => {
    expect(decide({ type: "claim" }, base)).toEqual({ type: "claimed" });
    expect(decide({ type: "claim" }, { ...base, issueOpen: false })).toEqual({ type: "issueClosed" });
  });

  it("refuses someone else's claim", () => {
    expect(decide({ type: "claim" }, { ...base, active })).toEqual({ type: "alreadyClaimed", by: "sam" });
    expect(decide({ type: "unclaim" }, { ...base, active })).toEqual({ type: "alreadyClaimed", by: "sam" });
  });

  it("lets the claimer or a maintainer unclaim", () => {
    expect(decide({ type: "unclaim" }, { ...base, actor: "SAM", active })).toEqual({ type: "unclaimed" });
    expect(decide({ type: "unclaim" }, { ...base, active, actorIsMaintainer: true })).toEqual({ type: "unclaimed" });
  });
});

describe("sweep", () => {
  const settings = resolveSettings({ claims: { remindAfterDays: 7, releaseAfterDays: 14 } });
  const claim = (days: number, remindedDaysAgo?: number): Claim => {
    const now = Date.parse("2026-11-20T00:00:00Z");
    const at = new Date(now - days * 86400_000).toISOString();
    return {
      issue: days,
      login: "sam",
      claimedAt: at,
      lastActivityAt: at,
      remindedAt: remindedDaysAgo === undefined ? undefined : new Date(now - remindedDaysAgo * 86400_000).toISOString(),
    };
  };

  it("reminds once, then releases", () => {
    const out = sweep([claim(3), claim(8), claim(9, 1), claim(15)], settings, "2026-11-20T00:00:00Z");
    expect(out.map((o) => [o.claim.issue, o.action])).toEqual([
      [8, "remind"],
      [15, "release"],
    ]);
  });

  it("writes messages that say what happens next", () => {
    expect(claimMessage({ type: "claimed" }, { login: "dana", settings })).toContain("14 days");
    expect(claimMessage({ type: "alreadyYours" }, { login: "dana", settings })).toBeNull();
  });
});
