import { createRequire } from "node:module";
import { Language, Parser, Query, type Node } from "web-tree-sitter";
import { LANGS, type LangId } from "./languages.js";

const require = createRequire(import.meta.url);

interface Loaded {
  parser: Parser;
  defs: Query[];
  calls: Query[];
}

let initialized: Promise<void> | null = null;
const loaded = new Map<LangId, Promise<Loaded>>();

function compile(language: Language, patterns: string[]): Query[] {
  const out: Query[] = [];
  for (const p of patterns) {
    try {
      out.push(new Query(language, p));
    } catch {
      // Pattern not supported by this grammar version; covered by tests.
    }
  }
  return out;
}

async function load(id: LangId): Promise<Loaded> {
  initialized ??= Parser.init();
  await initialized;
  let entry = loaded.get(id);
  if (!entry) {
    entry = (async () => {
      const spec = LANGS[id];
      const language = await Language.load(require.resolve(spec.wasm));
      const parser = new Parser();
      parser.setLanguage(language);
      return { parser, defs: compile(language, spec.defs), calls: compile(language, spec.calls) };
    })();
    loaded.set(id, entry);
  }
  return entry;
}

/** How many patterns compiled for a language, for tests and diagnostics. */
export async function compiledPatternCount(id: LangId): Promise<{ defs: number; calls: number }> {
  const l = await load(id);
  return { defs: l.defs.length, calls: l.calls.length };
}

export interface CallRef {
  /** 1-based line number. */
  line: number;
  name: string;
  /** Receiver text for member calls, e.g. "this" or "utils". */
  object?: string;
}

export interface ImportRef {
  line: number;
  /** Local binding name. */
  binding: string;
  /** Name imported from the module (for named imports). */
  imported?: string;
  kind: "named" | "namespace" | "default";
  source: string;
}

export interface FileAnalysis {
  lang: LangId;
  defs: Set<string>;
  calls: CallRef[];
  imports: ImportRef[];
}

const unquote = (s: string) => s.replace(/^['"`]|['"`]$/g, "");

function jsImports(root: Node): ImportRef[] {
  const out: ImportRef[] = [];
  for (const stmt of root.descendantsOfType("import_statement")) {
    if (!stmt) continue;
    const src = stmt.childForFieldName("source");
    if (!src) continue;
    const source = unquote(src.text);
    const line = stmt.startPosition.row + 1;
    for (const clause of stmt.descendantsOfType("import_clause")) {
      for (const child of clause?.namedChildren ?? []) {
        if (!child) continue;
        if (child.type === "identifier") out.push({ line, binding: child.text, kind: "default", source });
        if (child.type === "namespace_import") {
          const id = child.namedChildren.find((c) => c?.type === "identifier");
          if (id) out.push({ line, binding: id.text, kind: "namespace", source });
        }
        if (child.type === "named_imports") {
          for (const spec of child.descendantsOfType("import_specifier")) {
            const name = spec?.childForFieldName("name");
            if (!spec || !name) continue;
            const alias = spec.childForFieldName("alias");
            out.push({ line: spec.startPosition.row + 1, binding: (alias ?? name).text, imported: name.text, kind: "named", source });
          }
        }
      }
    }
  }
  return out;
}

function pyImports(root: Node): ImportRef[] {
  const out: ImportRef[] = [];
  for (const stmt of root.descendantsOfType("import_from_statement")) {
    if (!stmt) continue;
    const mod = stmt.childForFieldName("module_name");
    if (!mod) continue;
    for (const n of stmt.childrenForFieldName("name")) {
      if (!n) continue;
      const line = n.startPosition.row + 1;
      if (n.type === "aliased_import") {
        const name = n.childForFieldName("name");
        const alias = n.childForFieldName("alias");
        if (name && alias) out.push({ line, binding: alias.text, imported: name.text, kind: "named", source: mod.text });
      } else {
        out.push({ line, binding: n.text, imported: n.text, kind: "named", source: mod.text });
      }
    }
  }
  for (const stmt of root.descendantsOfType("import_statement")) {
    if (!stmt) continue;
    for (const n of stmt.childrenForFieldName("name")) {
      if (!n) continue;
      const line = n.startPosition.row + 1;
      if (n.type === "aliased_import") {
        const name = n.childForFieldName("name");
        const alias = n.childForFieldName("alias");
        if (name && alias) out.push({ line, binding: alias.text, kind: "namespace", source: name.text });
      } else {
        // `import a.b` binds `a`; only a plain `import a` is a usable namespace for member checks.
        if (!n.text.includes(".")) out.push({ line, binding: n.text, kind: "namespace", source: n.text });
      }
    }
  }
  return out;
}

function goImports(root: Node): ImportRef[] {
  const out: ImportRef[] = [];
  for (const spec of root.descendantsOfType("import_spec")) {
    if (!spec) continue;
    const path = spec.childForFieldName("path");
    if (!path) continue;
    const source = unquote(path.text);
    const name = spec.childForFieldName("name");
    if (name && (name.type === "dot" || name.type === "blank_identifier")) continue;
    const binding = name ? name.text : source.split("/").pop()!;
    out.push({ line: spec.startPosition.row + 1, binding, kind: "namespace", source });
  }
  return out;
}

/** Parse one file and pull out what the ghost-code check needs. */
export async function analyzeFile(lang: LangId, source: string): Promise<FileAnalysis> {
  const { parser, defs: defQueries, calls: callQueries } = await load(lang);
  const tree = parser.parse(source);
  if (!tree) return { lang, defs: new Set(), calls: [], imports: [] };
  try {
    const root = tree.rootNode;
    const defs = new Set<string>();
    for (const q of defQueries) for (const c of q.captures(root)) defs.add(c.node.text);

    const calls: CallRef[] = [];
    for (const q of callQueries) {
      for (const m of q.matches(root)) {
        const callee = m.captures.find((c) => c.name === "callee");
        const prop = m.captures.find((c) => c.name === "prop");
        const obj = m.captures.find((c) => c.name === "obj");
        if (callee) calls.push({ line: callee.node.startPosition.row + 1, name: callee.node.text });
        else if (prop && obj) calls.push({ line: prop.node.startPosition.row + 1, name: prop.node.text, object: obj.node.text });
      }
    }

    const imports = lang === "python" ? pyImports(root) : lang === "go" ? goImports(root) : jsImports(root);
    return { lang, defs, calls, imports };
  } finally {
    tree.delete();
  }
}
