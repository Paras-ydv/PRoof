import { useState } from "react";
import { FolderGit2, Lock, Plus, RefreshCw, SlidersHorizontal } from "lucide-react";
import { api, ApiError } from "../api/client";
import type { Repo, Settings, SettingsPatch } from "../api/types";
import { useWorkspace, useWorkspaceMutation } from "../lib/hooks";
import { SCORED_CHECKS } from "../lib/checks";
import { Button, ButtonLink } from "../components/Button";
import { Segmented, Switch } from "../components/Form";
import { Callout, Dialog, EmptyState, PageHeader, Panel, Skeleton, useToast } from "../components/Layout";
import { Badge, ModeTag } from "../components/Status";
import "../components/table.css";
import "./pages.css";

type Choice = "inherit" | "off" | "shadow" | "live";

export function Repos() {
  const ws = useWorkspace();
  const [editing, setEditing] = useState<Repo | null>(null);
  const toast = useToast();
  const sync = useWorkspaceMutation((login, _: void) => api<{ count: number }>(`/workspaces/${login}/repos/sync`, { method: "POST" }));
  const refresh = () =>
    sync.mutate(undefined, {
      onSuccess: (r) => toast("pass", `Up to date with GitHub: ${(r as { count: number }).count} repositories`),
      onError: (e) => toast("fail", e instanceof ApiError ? e.message : "Couldn't refresh from GitHub"),
    });
  const toggle = useWorkspaceMutation((login, v: { id: string; enabled: boolean }) => api(`/workspaces/${login}/repos/${v.id}`, { method: "PATCH", body: { enabled: v.enabled } }));

  if (ws.isLoading || !ws.data) return <Skeleton height={300} radius={11} />;
  const { repos, workspace } = ws.data;

  return (
    <div className="stack">
      <PageHeader
        title="Repositories"
        description="Repositories PRoof can see, from your GitHub installation. Pause one here, or change which repos are included on GitHub."
        actions={
          <>
            <Button variant="ghost" icon={<RefreshCw />} loading={sync.isPending} onClick={refresh}>
              Refresh from GitHub
            </Button>
            <ButtonLink to={workspace.installUrl} icon={<Plus />}>
              Add repositories on GitHub
            </ButtonLink>
          </>
        }
      />
      <Panel flush>
        {repos.length === 0 ? (
          <EmptyState icon={<FolderGit2 />} title="No repositories yet">
            Repositories appear here as soon as GitHub tells PRoof about them. If you just installed PRoof, use Refresh from GitHub.
          </EmptyState>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Repository</th>
                <th>Overrides</th>
                <th className="num">Active</th>
              </tr>
            </thead>
            <tbody>
              {repos.map((r) => {
                const n = Object.keys((r.settings as SettingsPatch).checks ?? {}).length;
                return (
                  <tr key={r.id}>
                    <td style={{ width: "100%" }}>
                      <span className="row mono" style={{ gap: 6 }}>
                        {r.private && <Lock size={12} aria-label="Private" />}
                        {r.fullName}
                      </span>
                    </td>
                    <td>
                      <Button size="sm" variant="ghost" icon={<SlidersHorizontal />} onClick={() => setEditing(r)}>
                        {n ? `${n} override${n === 1 ? "" : "s"}` : "Workspace defaults"}
                      </Button>
                    </td>
                    <td className="num">
                      <Switch aria-label={`${r.fullName} active`} checked={r.enabled} onChange={(enabled) => toggle.mutate({ id: r.id, enabled })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
      {editing && <Overrides repo={editing} orgEffective={workspace.effective} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Overrides({ repo, orgEffective, onClose }: { repo: Repo; orgEffective: Settings; onClose: () => void }) {
  const toast = useToast();
  const initial = Object.fromEntries(SCORED_CHECKS.map((c) => [c.id, ((repo.settings as SettingsPatch).checks?.[c.id] as Choice | undefined) ?? "inherit"])) as Record<string, Choice>;
  const [choices, setChoices] = useState(initial);
  const save = useWorkspaceMutation((login, patch: SettingsPatch) => api(`/workspaces/${login}/repos/${repo.id}/settings`, { method: "PUT", body: patch }));

  async function submit() {
    const checks = Object.fromEntries(Object.entries(choices).filter(([, v]) => v !== "inherit"));
    const rest = { ...(repo.settings as SettingsPatch) };
    delete rest.checks;
    try {
      await save.mutateAsync(Object.keys(checks).length ? { ...rest, checks } : rest);
      toast("pass", `Saved overrides for ${repo.fullName}`);
      onClose();
    } catch {
      /* inline */
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      width={620}
      title={`Overrides for ${repo.fullName.split("/")[1]}`}
      description="Anything left on Inherit follows the workspace setting shown next to it."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            Save overrides
          </Button>
        </>
      }
    >
      <div className="setting-list" style={{ margin: "0 -20px" }}>
        {SCORED_CHECKS.map((c) => (
          <div className="setting" key={c.id}>
            <div className="setting-text">
              <div className="setting-title">{c.title}</div>
              <div className="setting-desc row" style={{ gap: 6 }}>
                Workspace: <ModeTag mode={orgEffective.checks[c.id]} />
              </div>
            </div>
            <div className="setting-controls">
              <Segmented<Choice>
                size="sm"
                label={`${c.title} for this repo`}
                value={choices[c.id]!}
                onChange={(v) => setChoices({ ...choices, [c.id]: v })}
                options={[
                  { value: "inherit", label: "Inherit", tone: "muted" },
                  { value: "off", label: "Off" },
                  { value: "shadow", label: "Shadow", tone: "private" },
                  { value: "live", label: "Live", tone: "pass" },
                ]}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="muted small">
        Only repo admins and org owners can change overrides. <Badge>Tip</Badge> Turn off Tests for docs-only repos.
      </p>
      {save.error && <Callout tone="fail">{save.error instanceof ApiError ? save.error.message : "Couldn't save."}</Callout>}
    </Dialog>
  );
}
