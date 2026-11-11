import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { api } from "../api/client";
import type { Accuracy, AuditEntry, Me, Meta, ReportDetail, ReportRow, SettingsPatch, Usage, WorkspaceDetail, WorkspaceSummary } from "../api/types";

export const useMeta = () => useQuery({ queryKey: ["meta"], queryFn: () => api<Meta>("/meta"), staleTime: Infinity, retry: false });
export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me"), retry: false, staleTime: 5 * 60_000 });
export const useWorkspaces = () => useQuery({ queryKey: ["workspaces"], queryFn: () => api<{ workspaces: WorkspaceSummary[] }>("/workspaces") });

export function useLogin() {
  return useParams().login!;
}

export function useWorkspace() {
  const login = useLogin();
  return useQuery({ queryKey: ["workspace", login], queryFn: () => api<WorkspaceDetail>(`/workspaces/${login}`) });
}

export function useReports(repo?: string) {
  const login = useLogin();
  return useQuery({
    queryKey: ["reports", login, repo ?? null],
    queryFn: () => api<{ reports: ReportRow[] }>(`/workspaces/${login}/reports${repo ? `?repo=${encodeURIComponent(repo)}` : ""}`),
    refetchInterval: 30_000,
  });
}

export function useReport(id: string) {
  const login = useLogin();
  return useQuery({ queryKey: ["report", login, id], queryFn: () => api<ReportDetail>(`/workspaces/${login}/reports/${id}`) });
}

export const useAudit = () => {
  const login = useLogin();
  return useQuery({ queryKey: ["audit", login], queryFn: () => api<{ entries: AuditEntry[] }>(`/workspaces/${login}/audit`) });
};
export const useUsage = () => {
  const login = useLogin();
  return useQuery({ queryKey: ["usage", login], queryFn: () => api<Usage>(`/workspaces/${login}/usage`) });
};
export const useAccuracy = () => {
  const login = useLogin();
  return useQuery({ queryKey: ["accuracy", login], queryFn: () => api<Accuracy>(`/workspaces/${login}/accuracy`) });
};

/** Mutation that refreshes the workspace afterwards. */
export function useWorkspaceMutation<V>(fn: (login: string, vars: V) => Promise<unknown>) {
  const login = useLogin();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: V) => fn(login, vars),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspace", login] });
      qc.invalidateQueries({ queryKey: ["audit", login] });
    },
  });
}

export function useSaveSettings() {
  return useWorkspaceMutation((login, patch: SettingsPatch) => api(`/workspaces/${login}/settings`, { method: "PUT", body: patch }));
}

/* Theme: system, light or dark. "System" sets no attribute so the OS setting applies. */
export type ThemeChoice = "system" | "light" | "dark";
const THEME_KEY = "proof-theme";

function readTheme(): ThemeChoice {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

export function useTheme(): [ThemeChoice, (t: ThemeChoice) => void] {
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
    try {
      if (theme === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* storage unavailable: the choice lasts for this visit */
    }
  }, [theme]);
  return [theme, setTheme];
}

/** "3 min ago", "2 h ago", "Nov 4" */
export function timeAgo(iso: string): string {
  const diff = (Date.now() - Date.parse(iso)) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export const formatNumber = (n: number) => new Intl.NumberFormat(undefined, { notation: n >= 100_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(n);
