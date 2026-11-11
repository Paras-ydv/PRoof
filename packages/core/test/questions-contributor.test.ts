import { describe, expect, it } from "vitest";
import { historyCheck, isNewcomer, sprayCheck } from "../src/checks/contributor.js";
import { questionsCheck } from "../src/checks/questions.js";
import type { QuestionState } from "../src/types.js";
import { input } from "./fixtures.js";

const q = (o: Partial<QuestionState> = {}): QuestionState => ({
  id: "q1",
  path: "src/a.ts",
  line: 10,
  question: "What happens when retries run out?",
  askedAt: "2026-11-10T12:00:00Z",
  ...o,
});

describe("questions check", () => {
  const review = { questions: { mode: "askAndReview" as const } };

  it("is off when disabled", () => {
    expect(questionsCheck.mode(input().settings)).toBe("off");
  });

  it("is pending until questions are posted", async () => {
    expect((await questionsCheck.run(input({}, review))).status).toBe("pending");
  });

  it("waits during the grace period without penalty", async () => {
    const r = await questionsCheck.run(input({ questions: [q()] }, review));
    expect(r.status).toBe("pending");
    expect(r.ratio).toBeUndefined();
  });

  it("scores reviewed answers", async () => {
    const r = await questionsCheck.run(
      input(
        {
          questions: [
            q({ answer: "It throws", review: { verdict: "good", reason: "Matches line 10" } }),
            q({ id: "q2", answer: "Not sure", review: { verdict: "partial", reason: "Vague" } }),
          ],
        },
        review,
      ),
    );
    expect(r).toMatchObject({ status: "pass", ratio: 0.75 });
  });

  it("counts overdue questions as zero", async () => {
    const r = await questionsCheck.run(input({ questions: [q({ askedAt: "2026-11-01T00:00:00Z" })] }, review));
    expect(r).toMatchObject({ status: "fail", ratio: 0 });
  });

  it("leaves judgement to the maintainer in askOnly mode", async () => {
    const r = await questionsCheck.run(input({ questions: [q({ answer: "It throws" })] }, { questions: { mode: "askOnly" } }));
    expect(r.status).toBe("pass");
    expect(r.ratio).toBeUndefined();
    expect(r.evidence[0]?.text).toContain("A: It throws");
  });
});

describe("spray check", () => {
  const events = (n: number, hoursAgo = 1) =>
    Array.from({ length: n }, (_, i) => ({
      repo: `stranger${i}/repo`,
      createdAt: new Date(Date.parse("2026-11-11T12:00:00Z") - hoursAgo * 3600_000).toISOString(),
    }));

  it("is n/a without data", async () => {
    expect((await sprayCheck.run(input())).status).toBe("na");
  });

  it("flags many unrelated repos inside the window", async () => {
    const r = await sprayCheck.run(input({ authorRecentPrs: events(9) }));
    expect(r.status).toBe("warn");
    expect(r.summary).toBe("9 PRs to 9 unrelated repos in 2 d");
    expect(r.ratio).toBeUndefined();
  });

  it("ignores old events, same-org repos and known repos", async () => {
    const r = await sprayCheck.run(
      input({
        authorRecentPrs: [
          ...events(9, 100),
          { repo: "acme/other", createdAt: "2026-11-11T11:00:00Z" },
          { repo: "friend/lib", createdAt: "2026-11-11T11:00:00Z" },
        ],
        authorKnownRepos: ["friend/lib"],
      }),
    );
    expect(r).toMatchObject({ status: "pass", summary: "0 PRs to 0 unrelated repos in 2 d" });
  });
});

describe("history check", () => {
  it("describes the author without scoring them", async () => {
    const r = await historyCheck.run(
      input({
        author: { login: "dana", association: "FIRST_TIME_CONTRIBUTOR" },
        authorHistory: { mergedPrs: 0, closedPrs: 1, claims: 3, claimsExpired: 2, claimsWithPr: 1 },
      }),
    );
    expect(r.summary).toBe("First-time contributor to this repo");
    expect(r.ratio).toBeUndefined();
    expect(r.evidence).toHaveLength(2);
    expect(isNewcomer("FIRST_TIME_CONTRIBUTOR")).toBe(true);
  });
});
