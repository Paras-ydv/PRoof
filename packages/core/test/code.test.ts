import { describe, expect, it } from "vitest";
import { sizeCheck, testsCheck } from "../src/checks/code.js";
import { input } from "./fixtures.js";

describe("tests check", () => {
  it("passes when tests change alongside code", async () => {
    const r = await testsCheck.run(
      input({
        files: [
          { path: "src/a.ts", status: "modified", additions: 3, deletions: 0 },
          { path: "src/a.test.ts", status: "modified", additions: 8, deletions: 0 },
        ],
      }),
    );
    expect(r).toMatchObject({ status: "pass", ratio: 1 });
  });

  it("warns when only source changes", async () => {
    const r = await testsCheck.run(input());
    expect(r.status).toBe("warn");
    expect(r.ratio).toBeCloseTo(1 / 3);
  });

  it("is n/a for docs-only changes", async () => {
    const r = await testsCheck.run(input({ files: [{ path: "docs/x.md", status: "modified", additions: 3, deletions: 0 }] }));
    expect(r.status).toBe("na");
  });

  it("fails when a test file is deleted", async () => {
    const r = await testsCheck.run(input({ files: [{ path: "tests/test_upload.py", status: "removed", additions: 0, deletions: 40 }] }));
    expect(r).toMatchObject({ status: "fail", ratio: 0 });
  });

  it("fails when assertions are removed", async () => {
    const patch = "@@ -1,3 +1,1 @@\n-  expect(a).toBe(1);\n-  expect(b).toBe(2);\n+  // removed";
    const r = await testsCheck.run(input({ files: [{ path: "src/a.spec.ts", status: "modified", additions: 1, deletions: 2, patch }] }));
    expect(r.status).toBe("fail");
    expect(r.evidence[0]?.text).toContain("2 test or assertion lines removed");
  });

  it("honours repo test patterns", async () => {
    const r = await testsCheck.run(
      input(
        {
          files: [
            { path: "lib/a.rb", status: "modified", additions: 3, deletions: 0 },
            { path: "checks/a_check.rb", status: "modified", additions: 3, deletions: 0 },
          ],
        },
        { testPatterns: ["checks/**"] },
      ),
    );
    expect(r.status).toBe("pass");
  });
});

describe("size check", () => {
  it("passes small PRs", async () => {
    expect((await sizeCheck.run(input())).ratio).toBe(1);
  });

  it("scales down between soft and hard limits", async () => {
    const r = await sizeCheck.run(input({ files: [{ path: "src/a.ts", status: "modified", additions: 950, deletions: 0 }] }));
    expect(r.ratio).toBe(0.5);
    expect(r.status).toBe("warn");
  });

  it("ignores lockfiles", async () => {
    const r = await sizeCheck.run(
      input({
        files: [
          { path: "src/a.ts", status: "modified", additions: 10, deletions: 0 },
          { path: "pnpm-lock.yaml", status: "modified", additions: 5000, deletions: 3000 },
        ],
      }),
    );
    expect(r.ratio).toBe(1);
  });

  it("can be skipped with a label", async () => {
    expect((await sizeCheck.run(input({ labels: ["proof:large-ok"] }))).status).toBe("na");
  });
});
