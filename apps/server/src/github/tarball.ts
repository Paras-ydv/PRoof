import { Readable } from "node:stream";
import { Parser, type ReadEntry } from "tar";
import { langForPath, type SourceFile } from "@proof/core";

export interface ExtractLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

export const DEFAULT_LIMITS: ExtractLimits = { maxFiles: 8000, maxFileBytes: 512 * 1024, maxTotalBytes: 80 * 1024 * 1024 };

/** Folders that hold dependencies or build output, not the repo's own code. */
const SKIP_DIRS = /(^|\/)(node_modules|vendor|third_party|dist|build|out|target|\.git|\.next|__pycache__|\.venv|venv|site-packages)\//;

/**
 * Pull source files (and go.mod) out of a GitHub tarball, in memory.
 * GitHub prefixes every path with "<owner>-<repo>-<sha>/"; that prefix is removed.
 */
export async function extractSources(tarball: Buffer, limits: ExtractLimits = DEFAULT_LIMITS): Promise<{ files: SourceFile[]; truncated: boolean }> {
  const files: SourceFile[] = [];
  let total = 0;
  let truncated = false;

  await new Promise<void>((resolve, reject) => {
    const parser = new Parser({
      onReadEntry: (entry: ReadEntry) => {
        const path = entry.path.split("/").slice(1).join("/");
        const wanted =
          entry.type === "File" &&
          !SKIP_DIRS.test(path) &&
          (path === "go.mod" || langForPath(path) !== null) &&
          entry.size <= limits.maxFileBytes;
        if (!wanted || truncated) {
          entry.resume();
          return;
        }
        if (files.length >= limits.maxFiles || total + entry.size > limits.maxTotalBytes) {
          truncated = true;
          entry.resume();
          return;
        }
        const chunks: Buffer[] = [];
        entry.on("data", (c: Buffer) => chunks.push(c));
        entry.on("end", () => {
          total += entry.size;
          files.push({ path, content: Buffer.concat(chunks).toString("utf8") });
        });
      },
    });
    parser.on("end", () => resolve());
    parser.on("error", reject);
    Readable.from(tarball).pipe(parser);
  });

  return { files, truncated };
}
