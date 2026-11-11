/**
 * The smallest patch that turns `base` into `next`.
 * Saving only the differences means a workspace keeps getting improved defaults
 * for anything it hasn't changed.
 */
export function diff(base: unknown, next: unknown): unknown {
  if (Array.isArray(next) || Array.isArray(base)) return JSON.stringify(base) === JSON.stringify(next) ? undefined : next;
  if (isObject(base) && isObject(next)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(next)) {
      const d = diff(base[key], next[key]);
      if (d !== undefined) out[key] = d;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return Object.is(base, next) ? undefined : next;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
