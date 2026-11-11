import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "tar";
import { describe, expect, it } from "vitest";
import { extractSources } from "../src/github/tarball.js";

async function makeTarball(files: Record<string, string>): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), "proof-tar-"));
  const root = "acme-widgets-abc123";
  for (const [p, content] of Object.entries(files)) {
    const full = join(dir, root, p);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  const chunks: Buffer[] = [];
  const stream = create({ gzip: true, cwd: dir }, [root]);
  for await (const c of stream as AsyncIterable<Buffer>) chunks.push(c);
  return Buffer.concat(chunks);
}

describe("extractSources", () => {
  it("keeps source files and go.mod, strips the prefix, skips dependencies", async () => {
    const tgz = await makeTarball({
      "src/a.ts": "export const a = 1;",
      "go.mod": "module x",
      "README.md": "# hi",
      "node_modules/lib/index.js": "x",
      "pkg/b.py": "def b(): pass",
    });
    const { files, truncated } = await extractSources(tgz);
    expect(files.map((f) => f.path).sort()).toEqual(["go.mod", "pkg/b.py", "src/a.ts"]);
    expect(files.find((f) => f.path === "src/a.ts")?.content).toBe("export const a = 1;");
    expect(truncated).toBe(false);
  });

  it("stops at the file limit", async () => {
    const tgz = await makeTarball({ "a.ts": "1", "b.ts": "2", "c.ts": "3" });
    const { files, truncated } = await extractSources(tgz, { maxFiles: 2, maxFileBytes: 1000, maxTotalBytes: 1000 });
    expect(files).toHaveLength(2);
    expect(truncated).toBe(true);
  });
});
