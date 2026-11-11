export const DEMO = import.meta.env.VITE_DEMO === "1";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fields?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

/**
 * Calls the PRoof API on the same origin. Writes carry a client header the server
 * requires, which blocks simple cross-site form posts. In demo mode, requests are
 * answered in the browser from sample data and nothing leaves the page.
 */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (DEMO) return (await import("./demo")).demoRequest<T>(path, init);
  const res = await fetch(`/api${path}`, {
    method: init.method ?? "GET",
    credentials: "same-origin",
    headers: { "x-proof-client": "web", ...(init.body !== undefined ? { "content-type": "application/json" } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status, data?.fields);
  }
  return data as T;
}

export const signInUrl = (returnTo = window.location.pathname) => `/auth/github/login?return_to=${encodeURIComponent(returnTo)}`;

export async function signOut() {
  if (DEMO) return;
  await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
}
