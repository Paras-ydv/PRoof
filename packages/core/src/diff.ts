export interface AddedLine {
  /** Line number in the new file. */
  line: number;
  text: string;
}

export interface RemovedLine {
  /** Line number in the old file. */
  line: number;
  text: string;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Parse a unified diff patch (as GitHub returns per file) into added and removed lines. */
export function parsePatch(patch: string | undefined): { added: AddedLine[]; removed: RemovedLine[] } {
  const added: AddedLine[] = [];
  const removed: RemovedLine[] = [];
  if (!patch) return { added, removed };

  let oldLine = 0;
  let newLine = 0;
  for (const raw of patch.split("\n")) {
    const hunk = HUNK.exec(raw);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      continue;
    }
    if (raw.startsWith("\\")) continue; // "\ No newline at end of file"
    if (raw.startsWith("+")) {
      added.push({ line: newLine, text: raw.slice(1) });
      newLine++;
    } else if (raw.startsWith("-")) {
      removed.push({ line: oldLine, text: raw.slice(1) });
      oldLine++;
    } else {
      oldLine++;
      newLine++;
    }
  }
  return { added, removed };
}

/** Convert a glob (supports **, *, ?) to a RegExp anchored to the whole path. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // "**/" matches zero or more directories
        if (glob[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

export function matchesAny(path: string, globs: string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(path));
}
