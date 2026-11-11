/**
 * Per-language tree-sitter queries and builtins for the ghost-code check.
 * Imports are not definitions: they are tracked separately so an import of a
 * name that doesn't exist is caught instead of hiding it.
 * Each pattern is compiled on its own; a pattern a grammar doesn't support is skipped
 * (and caught by tests), so one bad pattern can't disable a whole language.
 */

export type LangId = "typescript" | "tsx" | "javascript" | "python" | "go";

export interface LangSpec {
  id: LangId;
  /** npm package and wasm file that ship the grammar. */
  wasm: string;
  /** Patterns capturing names that are defined (@d). */
  defs: string[];
  /** Patterns capturing bare calls (@callee) and member calls (@obj + @prop). */
  calls: string[];
  /** Receivers that refer to the current object. */
  selfNames: string[];
  builtins: Set<string>;
}

const JS_DEFS = [
  "(function_declaration name: (identifier) @d)",
  "(generator_function_declaration name: (identifier) @d)",
  "(class_declaration name: (_) @d)",
  "(method_definition name: (_) @d)",
  "(variable_declarator name: (identifier) @d)",
  "(object_pattern (shorthand_property_identifier_pattern) @d)",
  "(pair_pattern value: (identifier) @d)",
  "(array_pattern (identifier) @d)",
  "(assignment_pattern left: (identifier) @d)",
  "(rest_pattern (identifier) @d)",
  "(formal_parameters (identifier) @d)",
  "(arrow_function parameter: (identifier) @d)",
  "(catch_clause parameter: (identifier) @d)",
  "(field_definition property: (_) @d)",
  "(pair key: (property_identifier) @d)",
  "(assignment_expression left: (member_expression property: (property_identifier) @d))",
  "(assignment_expression left: (identifier) @d)",
  "(for_in_statement left: (identifier) @d)",
];

const TS_DEFS = [
  ...JS_DEFS.filter((p) => !p.startsWith("(field_definition") && !p.startsWith("(formal_parameters")),
  "(required_parameter pattern: (identifier) @d)",
  "(optional_parameter pattern: (identifier) @d)",
  "(public_field_definition name: (_) @d)",
  "(abstract_class_declaration name: (_) @d)",
  "(abstract_method_signature name: (_) @d)",
  "(method_signature name: (_) @d)",
  "(property_signature name: (_) @d)",
  "(function_signature name: (_) @d)",
  "(interface_declaration name: (_) @d)",
  "(type_alias_declaration name: (_) @d)",
  "(enum_declaration name: (_) @d)",
  "(enum_body (property_identifier) @d)",
];

const JS_CALLS = [
  "(call_expression function: (identifier) @callee)",
  "(call_expression function: (member_expression object: (_) @obj property: (property_identifier) @prop))",
  "(new_expression constructor: (identifier) @callee)",
];

const JS_BUILTINS = new Set(
  (
    "Array ArrayBuffer AggregateError Atomics BigInt BigInt64Array BigUint64Array Boolean DataView Date Error " +
    "EvalError FinalizationRegistry Float32Array Float64Array Function Int8Array Int16Array Int32Array Intl JSON " +
    "Map Math Number Object Promise Proxy RangeError ReferenceError Reflect RegExp Set SharedArrayBuffer String " +
    "Symbol SyntaxError TypeError URIError Uint8Array Uint8ClampedArray Uint16Array Uint32Array WeakMap WeakRef " +
    "WeakSet decodeURI decodeURIComponent encodeURI encodeURIComponent escape unescape eval isFinite isNaN " +
    "parseFloat parseInt globalThis " +
    // Web and Node platform
    "AbortController AbortSignal Blob BroadcastChannel Buffer CustomEvent Event EventTarget File FormData Headers " +
    "MessageChannel Request Response TextDecoder TextEncoder URL URLSearchParams WebSocket Worker ReadableStream " +
    "WritableStream TransformStream atob btoa clearImmediate clearInterval clearTimeout console crypto fetch " +
    "performance process queueMicrotask require setImmediate setInterval setTimeout structuredClone " +
    "alert confirm prompt requestAnimationFrame cancelAnimationFrame requestIdleCallback getComputedStyle " +
    "matchMedia IntersectionObserver MutationObserver ResizeObserver Image XMLHttpRequest " +
    // Common test globals
    "describe it test expect beforeEach afterEach beforeAll afterAll jest vi suite"
  ).split(" "),
);

const PY_DEFS = [
  "(function_definition name: (identifier) @d)",
  "(class_definition name: (identifier) @d)",
  "(assignment left: (identifier) @d)",
  "(assignment left: (attribute attribute: (identifier) @d))",
  "(augmented_assignment left: (identifier) @d)",
  "(pattern_list (identifier) @d)",
  "(tuple_pattern (identifier) @d)",
  "(parameters (identifier) @d)",
  "(lambda_parameters (identifier) @d)",
  "(default_parameter name: (identifier) @d)",
  "(typed_parameter (identifier) @d)",
  "(typed_default_parameter name: (identifier) @d)",
  "(list_splat_pattern (identifier) @d)",
  "(dictionary_splat_pattern (identifier) @d)",
  "(for_statement left: (identifier) @d)",
  "(for_in_clause left: (identifier) @d)",
  "(as_pattern alias: (as_pattern_target (identifier) @d))",
  "(named_expression name: (identifier) @d)",
  "(global_statement (identifier) @d)",
];

const PY_CALLS = [
  "(call function: (identifier) @callee)",
  "(call function: (attribute object: (_) @obj attribute: (identifier) @prop))",
];

const PY_BUILTINS = new Set(
  (
    "abs aiter all anext any ascii bin bool breakpoint bytearray bytes callable chr classmethod compile complex " +
    "delattr dict dir divmod enumerate eval exec filter float format frozenset getattr globals hasattr hash help " +
    "hex id input int isinstance issubclass iter len list locals map max memoryview min next object oct open ord " +
    "pow print property range repr reversed round set setattr slice sorted staticmethod str sum super tuple type " +
    "vars zip __import__ BaseException Exception ArithmeticError AssertionError AttributeError BufferError " +
    "EOFError ImportError ModuleNotFoundError LookupError IndexError KeyError KeyboardInterrupt MemoryError " +
    "NameError NotImplementedError OSError OverflowError RecursionError ReferenceError RuntimeError " +
    "StopIteration StopAsyncIteration SyntaxError SystemError SystemExit TypeError UnboundLocalError " +
    "UnicodeError UnicodeDecodeError UnicodeEncodeError ValueError ZeroDivisionError FileNotFoundError " +
    "FileExistsError PermissionError TimeoutError ConnectionError NotADirectoryError IsADirectoryError " +
    "Warning DeprecationWarning UserWarning RuntimeWarning ExceptionGroup BaseExceptionGroup"
  ).split(" "),
);

const GO_DEFS = [
  "(function_declaration name: (identifier) @d)",
  "(method_declaration name: (field_identifier) @d)",
  "(type_spec name: (type_identifier) @d)",
  "(var_spec name: (identifier) @d)",
  "(const_spec name: (identifier) @d)",
  "(short_var_declaration left: (expression_list (identifier) @d))",
  "(parameter_declaration name: (identifier) @d)",
  "(variadic_parameter_declaration name: (identifier) @d)",
  "(field_declaration name: (field_identifier) @d)",
  "(method_elem name: (field_identifier) @d)",
  "(range_clause left: (expression_list (identifier) @d))",
];

const GO_CALLS = [
  "(call_expression function: (identifier) @callee)",
  "(call_expression function: (selector_expression operand: (_) @obj field: (field_identifier) @prop))",
];

const GO_BUILTINS = new Set(
  "append cap clear close complex copy delete imag len make max min new panic print println real recover".split(" "),
);

export const LANGS: Record<LangId, LangSpec> = {
  typescript: {
    id: "typescript",
    wasm: "tree-sitter-typescript/tree-sitter-typescript.wasm",
    defs: TS_DEFS,
    calls: JS_CALLS,
    selfNames: ["this", "super"],
    builtins: JS_BUILTINS,
  },
  tsx: {
    id: "tsx",
    wasm: "tree-sitter-typescript/tree-sitter-tsx.wasm",
    defs: TS_DEFS,
    calls: JS_CALLS,
    selfNames: ["this", "super"],
    builtins: JS_BUILTINS,
  },
  javascript: {
    id: "javascript",
    wasm: "tree-sitter-javascript/tree-sitter-javascript.wasm",
    defs: JS_DEFS,
    calls: JS_CALLS,
    selfNames: ["this", "super"],
    builtins: JS_BUILTINS,
  },
  python: {
    id: "python",
    wasm: "tree-sitter-python/tree-sitter-python.wasm",
    defs: PY_DEFS,
    calls: PY_CALLS,
    selfNames: ["self", "cls"],
    builtins: PY_BUILTINS,
  },
  go: {
    id: "go",
    wasm: "tree-sitter-go/tree-sitter-go.wasm",
    defs: GO_DEFS,
    calls: GO_CALLS,
    selfNames: [],
    builtins: GO_BUILTINS,
  },
};

export function langForPath(path: string): LangId | null {
  if (/\.d\.ts$/.test(path)) return null;
  if (/\.(ts|mts|cts)$/.test(path)) return "typescript";
  if (/\.tsx$/.test(path)) return "tsx";
  if (/\.(js|jsx|mjs|cjs)$/.test(path)) return "javascript";
  if (/\.py$/.test(path)) return "python";
  if (/\.go$/.test(path)) return "go";
  return null;
}
