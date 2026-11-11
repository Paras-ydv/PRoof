import { describe, expect, it } from "vitest";
import { compiledPatternCount } from "../src/ghost/extract.js";
import { buildSymbolIndex, findGhosts, ghostCodeCheck } from "../src/ghost/index.js";
import { LANGS, type LangId } from "../src/ghost/languages.js";
import { input } from "./fixtures.js";

/** A patch that marks every line of `content` as added. */
const allAdded = (content: string) => {
  const lines = content.split("\n");
  return `@@ -0,0 +1,${lines.length} @@\n` + lines.map((l) => "+" + l).join("\n");
};

describe("language specs", () => {
  for (const id of Object.keys(LANGS) as LangId[]) {
    it(`compiles every ${id} pattern`, async () => {
      const n = await compiledPatternCount(id);
      expect(n.defs).toBe(LANGS[id].defs.length);
      expect(n.calls).toBe(LANGS[id].calls.length);
    });
  }
});

describe("findGhosts · TypeScript", () => {
  const utils = { path: "src/utils.ts", content: "export function retry(fn: () => void, times: number) {}\n" };

  it("flags bare calls and local imports that resolve nowhere", async () => {
    const content = [
      'import { retry, retryWithBackoff } from "./utils";',
      'import { z } from "zod";',
      "export class Uploader {",
      "  upload(file: string) {",
      "    retry(() => {}, 3);",
      "    retryWithBackoff();",
      "    this.validate(file);",
      "    this.send(file);",
      "    z.string().parse(file);",
      "    sanitizePath(file);",
      "    console.log(JSON.stringify(file));",
      "  }",
      "  send(f: string) {}",
      "}",
    ].join("\n");
    const index = await buildSymbolIndex([utils, { path: "src/uploader.ts", content }]);
    const ghosts = await findGhosts({ path: "src/uploader.ts", content, patch: allAdded(content) }, index);
    expect(ghosts.map((g) => [g.line, g.name])).toEqual([
      [1, "retryWithBackoff"],
      [7, "this.validate"],
      [10, "sanitizePath"],
    ]);
  });

  it("only looks at added lines", async () => {
    const content = "function a() {\n  missingOne();\n  missingTwo();\n}";
    const index = await buildSymbolIndex([{ path: "a.ts", content }]);
    const patch = "@@ -1,3 +1,4 @@\n function a() {\n   missingOne();\n+  missingTwo();\n }";
    const ghosts = await findGhosts({ path: "a.ts", content, patch }, index);
    expect(ghosts.map((g) => g.name)).toEqual(["missingTwo"]);
  });

  it("does not flag parameters, destructured names or calls on unknown objects", async () => {
    const content = [
      "export function run(cb: () => void, { onDone }: { onDone: () => void }, opts?: any) {",
      "  cb();",
      "  onDone();",
      "  opts.whatever.deep();",
      "  const [first] = [() => 1];",
      "  first();",
      "  [1, 2].map((n) => n).filter(Boolean);",
      "}",
    ].join("\n");
    const index = await buildSymbolIndex([{ path: "r.ts", content }]);
    expect(await findGhosts({ path: "r.ts", content, patch: allAdded(content) }, index)).toEqual([]);
  });

  it("counts names the PR itself adds in other files", async () => {
    const helper = { path: "src/new-helper.ts", content: "export const slugify = (s: string) => s;" };
    const content = 'import { slugify } from "./new-helper";\nslugify("x");';
    const index = await buildSymbolIndex([helper, { path: "src/page.ts", content }]);
    expect(await findGhosts({ path: "src/page.ts", content, patch: allAdded(content) }, index)).toEqual([]);
  });
});

describe("findGhosts · Python", () => {
  it("resolves package imports and self methods", async () => {
    const lib = { path: "mypkg/utils.py", content: "def retry(fn, times=3):\n    pass\n" };
    const content = [
      "from mypkg.utils import retry, retry_async",
      "import requests",
      "",
      "class Client:",
      "    def get(self, url):",
      "        retry(lambda: requests.get(url))",
      "        self.validate(url)",
      "        print(len(url))",
      "        made_up_helper(url)",
    ].join("\n");
    const index = await buildSymbolIndex([lib, { path: "mypkg/client.py", content }]);
    const ghosts = await findGhosts({ path: "mypkg/client.py", content, patch: allAdded(content) }, index);
    expect(ghosts.map((g) => g.name)).toEqual(["retry_async", "self.validate", "made_up_helper"]);
  });

  it("skips self methods in classes that inherit from another class", async () => {
    const content = [
      "import unittest",
      "",
      "class TestThing(unittest.TestCase):",
      "    def test_it(self):",
      "        self.assertTrue(True)",
      "",
      "class Plain(object):",
      "    def run(self):",
      "        self.missing()",
    ].join("\n");
    const index = await buildSymbolIndex([{ path: "tests/test_thing.py", content }]);
    const ghosts = await findGhosts({ path: "tests/test_thing.py", content, patch: allAdded(content) }, index);
    expect(ghosts.map((g) => g.name)).toEqual(["self.missing"]);
  });
});

describe("findGhosts · inherited TypeScript methods", () => {
  it("skips this-calls in classes that extend another, but not ones that only implement", async () => {
    const content = [
      'import { Component } from "react";',
      "interface Runner { run(): void }",
      "export class View extends Component {",
      "  show() { this.setState({}); }",
      "}",
      "export class Job implements Runner {",
      "  run() { this.missing(); }",
      "}",
    ].join("\n");
    const index = await buildSymbolIndex([{ path: "src/view.ts", content }]);
    const ghosts = await findGhosts({ path: "src/view.ts", content, patch: allAdded(content) }, index);
    expect(ghosts.map((g) => g.name)).toEqual(["this.missing"]);
  });
});

describe("findGhosts · Go", () => {
  it("checks calls into the module's own packages only", async () => {
    const gomod = { path: "go.mod", content: "module github.com/acme/widgets\n\ngo 1.24\n" };
    const util = { path: "internal/util/util.go", content: "package util\n\nfunc Retry(n int) error { return nil }\n" };
    const content = [
      "package main",
      "",
      'import (\n\t"fmt"\n\t"github.com/acme/widgets/internal/util"\n)',
      "",
      "func main() {",
      "\tutil.Retry(3)",
      "\tutil.RetryWithBackoff(3)",
      '\tfmt.Println("ok")',
      "\tdoMagic()",
      "}",
    ].join("\n");
    const index = await buildSymbolIndex([gomod, util, { path: "cmd/main.go", content }]);
    const ghosts = await findGhosts({ path: "cmd/main.go", content, patch: allAdded(content) }, index);
    expect(ghosts.map((g) => g.name)).toEqual(["util.RetryWithBackoff", "doMagic"]);
  });
});

describe("ghost-code check", () => {
  it("is n/a without an index", async () => {
    expect((await ghostCodeCheck.run(input())).status).toBe("na");
  });

  it("scores by the number of ghost names", async () => {
    const content = "export function a() {\n  nope();\n}";
    const index = await buildSymbolIndex([{ path: "src/a.ts", content }]);
    const r = await ghostCodeCheck.run(
      input({
        symbolIndex: index,
        files: [{ path: "src/a.ts", status: "added", additions: 3, deletions: 0, patch: allAdded(content), headContent: content }],
      }),
    );
    expect(r.status).toBe("fail");
    expect(r.ratio).toBe(0.67);
    expect(r.evidence[0]).toMatchObject({ path: "src/a.ts", line: 2 });
  });
});
