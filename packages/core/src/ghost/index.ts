import { parsePatch } from "../diff.js";
import type { Check, CheckResult, Evidence, SymbolIndex } from "../types.js";
import { analyzeFile, type FileAnalysis, type ImportRef } from "./extract.js";
import { LANGS, langForPath } from "./languages.js";

export { analyzeFile } from "./extract.js";
export { langForPath } from "./languages.js";

export interface SourceFile {
  path: string;
  content: string;
}

/**
 * Build the repo symbol index from source files at the PR head.
 * Callers pass every source file they want indexed; non-source files are ignored.
 */
export async function buildSymbolIndex(files: SourceFile[]): Promise<SymbolIndex> {
  const defined = new Set<string>();
  const pythonPackages = new Set<string>();
  let goModule: string | undefined;
  let fileCount = 0;

  for (const f of files) {
    if (f.path === "go.mod") {
      goModule = /^module\s+(\S+)/m.exec(f.content)?.[1];
      continue;
    }
    const lang = langForPath(f.path);
    if (!lang) continue;
    if (lang === "python") {
      const parts = f.path.split("/");
      // Count both top-level packages and src-layout packages (src/pkg/...).
      if (parts.length > 1) pythonPackages.add(parts[0] === "src" && parts.length > 2 ? parts[1]! : parts[0]!);
      else pythonPackages.add(parts[0]!.replace(/\.py$/, ""));
    }
    const a = await analyzeFile(lang, f.content);
    for (const d of a.defs) defined.add(d);
    fileCount++;
  }
  return { defined, pythonPackages, goModule, fileCount };
}

function isLocalImport(imp: ImportRef, lang: FileAnalysis["lang"], index: SymbolIndex): boolean {
  const s = imp.source;
  if (lang === "python") return s.startsWith(".") || index.pythonPackages.has(s.split(".")[0]!);
  if (lang === "go") return !!index.goModule && (s === index.goModule || s.startsWith(index.goModule + "/"));
  return s.startsWith("./") || s.startsWith("../") || s.startsWith("@/") || s.startsWith("~/") || s.startsWith("/");
}

export interface Ghost {
  path: string;
  line: number;
  name: string;
  /** Short reason shown as evidence. */
  why: string;
}

/**
 * Find names on added lines that resolve nowhere.
 * Precision first: only flags what can be proven missing.
 *  - bare calls to names that aren't defined, imported, or built in
 *  - calls on this/self to methods defined nowhere in the repo, unless the class extends another
 *    (the method may come from a parent outside the repo, like unittest.TestCase)
 *  - calls on a local module import to members defined nowhere in the repo
 *  - named imports from a local module that the repo doesn't define
 * Calls on other objects (whose type we can't know) are never flagged.
 */
export async function findGhosts(file: SourceFile & { patch?: string }, index: SymbolIndex): Promise<Ghost[]> {
  const lang = langForPath(file.path);
  if (!lang || !file.patch) return [];
  const added = new Set(parsePatch(file.patch).added.map((l) => l.line));
  if (added.size === 0) return [];

  const a = await analyzeFile(lang, file.content);
  const spec = LANGS[lang];
  const bindings = new Map(a.imports.map((i) => [i.binding, i]));
  const exists = (n: string) => index.defined.has(n) || a.defs.has(n);
  const ghosts: Ghost[] = [];
  const seen = new Set<string>();
  const add = (g: Ghost) => {
    const key = `${g.line}:${g.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      ghosts.push({ ...g, path: file.path });
    }
  };

  for (const imp of a.imports) {
    if (!added.has(imp.line) || imp.kind !== "named" || !imp.imported) continue;
    if (isLocalImport(imp, lang, index) && !index.defined.has(imp.imported)) {
      add({ path: file.path, line: imp.line, name: imp.imported, why: `imported from ${imp.source}, which doesn't define it` });
    }
  }

  for (const c of a.calls) {
    if (!added.has(c.line)) continue;
    if (c.object === undefined) {
      if (exists(c.name) || bindings.has(c.name) || spec.builtins.has(c.name)) continue;
      add({ path: file.path, line: c.line, name: c.name, why: "called, but not defined or imported anywhere" });
      continue;
    }
    if (spec.selfNames.includes(c.object)) {
      if (!c.inherited && !exists(c.name)) add({ path: file.path, line: c.line, name: `${c.object}.${c.name}`, why: "method not defined anywhere in the repo" });
      continue;
    }
    const imp = bindings.get(c.object);
    if (imp && imp.kind === "namespace" && isLocalImport(imp, lang, index) && !index.defined.has(c.name)) {
      add({ path: file.path, line: c.line, name: `${c.object}.${c.name}`, why: `${imp.source} doesn't define ${c.name}` });
    }
  }
  return ghosts.sort((x, y) => x.line - y.line);
}

/** A5 · Ghost code */
export const ghostCodeCheck: Check = {
  id: "ghostCode",
  title: "Ghost code",
  kind: "scored",
  weight: (s) => s.weights.ghostCode,
  mode: (s) => s.checks.ghostCode,
  async run({ pr }): Promise<CheckResult> {
    const base = { id: "ghostCode", title: "Ghost code", kind: "scored" as const, rule: "ghost-code" };
    const index = pr.symbolIndex;
    const candidates = pr.files.filter((f) => f.status !== "removed" && langForPath(f.path) && f.headContent && f.patch);
    if (!index || candidates.length === 0) {
      return { ...base, status: "na", summary: "No supported source files to check", evidence: [] };
    }
    const ghosts: Ghost[] = [];
    for (const f of candidates) ghosts.push(...(await findGhosts({ path: f.path, content: f.headContent!, patch: f.patch }, index)));

    if (ghosts.length === 0) {
      return { ...base, status: "pass", ratio: 1, summary: "Every called name exists in the repo", evidence: [] };
    }
    const evidence: Evidence[] = ghosts.slice(0, 10).map((g) => ({ text: `\`${g.name}\` ${g.why}`, path: g.path, line: g.line }));
    // Each ghost name costs a third of the check; three or more score zero.
    const ratio = Math.max(0, Math.round((1 - ghosts.length / 3) * 100) / 100);
    return {
      ...base,
      status: "fail",
      ratio,
      summary: `${ghosts.length} name${ghosts.length === 1 ? "" : "s"} called that exist${ghosts.length === 1 ? "s" : ""} nowhere`,
      evidence,
    };
  },
};
