import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deliveries, destinations, eq, prCards, reports, workspaces } from "@proof/db";
import { analyzePr, type AnalyzeJob } from "../src/pipeline/analyze.js";
import { baseDeps, tarballOf, testDb } from "./helpers.js";

const content = 'import { retry } from "./util";\n\nexport function upload() {\n  retry();\n  uploadWithMagic();\n}\n';
const patch = "@@ -0,0 +1,6 @@\n" + content.trimEnd().split("\n").map((l) => "+" + l).join("\n");

function fakeGithub(log: string[]) {
  return {
    paginate: async () => [{ filename: "src/upload.ts", status: "added", additions: 6, deletions: 0, patch }],
    graphql: async () => ({ repository: { pullRequest: { closingIssuesReferences: { nodes: [{ number: 4, title: "Upload", assignees: { nodes: [{ login: "dana" }] } }] } } } }),
    rest: {
      pulls: { listFiles: () => {} },
      repos: {
        getContent: async () => {
          throw Object.assign(new Error("nf"), { status: 404 });
        },
        getCombinedStatusForRef: async () => ({ data: { statuses: [] } }),
        downloadTarballArchive: async () => ({ data: await tarballOf({ "src/util.ts": "export function retry() {}", "src/upload.ts": content }) }),
      },
      checks: { listForRef: async () => ({ data: { check_runs: [{ name: "test", status: "completed", conclusion: "success", app: { slug: "github-actions" } }] } }) },
      actions: { listWorkflowRunsForRepo: async () => ({ data: { total_count: 0 } }) },
      activity: { listPublicEventsForUser: async () => ({ data: [] }) },
      issues: {
        createComment: async (p: any) => {
          log.push("create:" + p.body.split("\n")[1]);
          return { data: { id: 555 } };
        },
        updateComment: async (p: any) => {
          log.push(`update:${p.comment_id}`);
          return { data: {} };
        },
      },
    },
  } as any;
}

const job: AnalyzeJob = {
  installationId: 77,
  repo: { id: 9001, fullName: "acme/widgets", private: false },
  pull: {
    number: 12,
    title: "Add upload",
    body: "Fixes #4",
    html_url: "https://github.com/acme/widgets/pull/12",
    user: { login: "dana", type: "User" },
    author_association: "CONTRIBUTOR",
    labels: [],
    head: { sha: "sha1", repo: { full_name: "dana/widgets" } },
    base: { ref: "main", repo: { default_branch: "main" } },
  },
};

describe("analyzePr", async () => {
  const { db, client } = await testDb();
  afterAll(() => client.end());
  const ghLog: string[] = [];
  const slackCalls: any[] = [];
  let deps: ReturnType<typeof baseDeps>;

  beforeAll(async () => {
    const [ws] = await db
      .insert(workspaces)
      .values({
        githubAccountId: 1,
        login: "acme",
        accountType: "Organization",
        installationId: 77,
        settings: { checks: { issue: "live", ci: "live", tests: "live", ghostCode: "live", spray: "shadow" } },
      })
      .returning();
    await db.insert(destinations).values({ workspaceId: ws!.id, type: "slack", audience: "maintainers", config: { channel: "C1" } });
    deps = baseDeps(db, {
      github: async () => fakeGithub(ghLog),
      channels: { slack: async (i) => void slackCalls.push(i), discord: async () => {}, email: async () => {}, webhook: async () => {} },
    });
  });

  it("builds, stores and posts a report with ghost-code evidence", async () => {
    await analyzePr(deps, job);
    const [row] = await db.select().from(reports);
    const report = row!.report as any;
    const ghost = report.items.find((i: any) => i.id === "ghostCode");
    expect(ghost.status).toBe("fail");
    expect(ghost.evidence[0].text).toContain("uploadWithMagic");
    expect(report.items.find((i: any) => i.id === "issue").status).toBe("pass");
    expect(row!.scorePublic).not.toBeNull();
    expect(ghLog).toEqual(["create:### PRoof · " + row!.scorePublic + "/100 · " + (row!.scorePublic! >= 80 ? "Ready for review" : row!.scorePublic! >= 60 ? "Small fixes" : "Needs work")]);
    expect(slackCalls).toHaveLength(1);
    // Maintainers get the shadow-mode spray row; the PR card doesn't.
    expect(slackCalls[0].report.items.some((i: any) => i.id === "spray")).toBe(true);
  });

  it("edits the same card on re-run and doesn't notify Slack twice", async () => {
    await analyzePr(deps, job);
    expect(ghLog.at(-1)).toBe("update:555");
    expect(slackCalls).toHaveLength(1);
    expect(await db.select().from(prCards)).toHaveLength(1);
    expect(await db.select().from(deliveries).where(eq(deliveries.status, "sent"))).toHaveLength(1);
  });

  it("ignores drafts and bots", async () => {
    await analyzePr(deps, { ...job, pull: { ...job.pull, number: 13, draft: true } });
    await analyzePr(deps, { ...job, pull: { ...job.pull, number: 14, user: { login: "dependabot[bot]", type: "Bot" } } });
    expect(await db.select().from(reports)).toHaveLength(1);
  });
});
