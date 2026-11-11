import { describe, expect, it } from "vitest";
import { globToRegExp, matchesAny, parsePatch } from "../src/diff.js";

describe("parsePatch", () => {
  it("tracks new and old line numbers across hunks", () => {
    const patch = [
      "@@ -1,3 +1,4 @@",
      " a",
      "-b",
      "+B",
      "+C",
      " d",
      "@@ -20,2 +21,2 @@",
      " x",
      "+y",
      "\\ No newline at end of file",
    ].join("\n");
    const { added, removed } = parsePatch(patch);
    expect(added).toEqual([
      { line: 2, text: "B" },
      { line: 3, text: "C" },
      { line: 22, text: "y" },
    ]);
    expect(removed).toEqual([{ line: 2, text: "b" }]);
  });

  it("handles a missing patch", () => {
    expect(parsePatch(undefined)).toEqual({ added: [], removed: [] });
  });
});

describe("globs", () => {
  it("matches ** across directories, including none", () => {
    expect(globToRegExp("tests/**").test("tests/a/b.py")).toBe(true);
    expect(globToRegExp("**/*_test.go").test("x_test.go")).toBe(true);
    expect(globToRegExp("**/*_test.go").test("pkg/a/x_test.go")).toBe(true);
    expect(globToRegExp("*.ts").test("src/a.ts")).toBe(false);
  });

  it("escapes regex characters", () => {
    expect(matchesAny("a.spec.ts", ["*.spec.ts"])).toBe(true);
    expect(matchesAny("aXspecXts", ["*.spec.ts"])).toBe(false);
  });
});
