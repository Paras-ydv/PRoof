import { useState, type ReactNode } from "react";
import { EyeOff, GitPullRequest, Globe, Hash, Mail, MessageCircle, Plus, Trash, Webhook } from "lucide-react";
import { api, ApiError } from "../api/client";
import type { Destination, DestinationInput, DestinationType } from "../api/types";
import { useWorkspace, useWorkspaceMutation } from "../lib/hooks";
import { Button } from "../components/Button";
import { Field, Input, Segmented, Select, Switch } from "../components/Form";
import { Callout, Dialog, EmptyState, PageHeader, Panel, Skeleton, useToast } from "../components/Layout";
import { VisibilityTag } from "../components/Status";
import "./pages.css";

const TYPES: Record<DestinationType, { name: string; icon: ReactNode; desc: string }> = {
  github: { name: "PR comment", icon: <GitPullRequest />, desc: "One comment on the PR, edited in place on every push." },
  slack: { name: "Slack", icon: <Hash />, desc: "A message in a channel, with links to the PR and full report." },
  discord: { name: "Discord", icon: <MessageCircle />, desc: "An embed in a channel, through a channel webhook." },
  email: { name: "Email", icon: <Mail />, desc: "One email per PR to the addresses you choose." },
  webhook: { name: "Webhook", icon: <Webhook />, desc: "Signed JSON to your own service: Teams, Zulip, scripts." },
};

export function Destinations() {
  const ws = useWorkspace();
  const [adding, setAdding] = useState(false);
  const toast = useToast();
  const update = useWorkspaceMutation((login, v: { id: string; enabled?: boolean; audience?: "public" | "maintainers" }) =>
    api(`/workspaces/${login}/destinations/${v.id}`, { method: "PATCH", body: { enabled: v.enabled, audience: v.audience } }),
  );
  const remove = useWorkspaceMutation((login, id: string) => api(`/workspaces/${login}/destinations/${id}`, { method: "DELETE" }));
  const createGithub = useWorkspaceMutation((login, enabled: boolean) => api(`/workspaces/${login}/destinations`, { method: "POST", body: { type: "github", enabled } }));

  if (ws.isLoading || !ws.data) return <Skeleton height={300} radius={11} />;
  const { destinations, repos, workspace } = ws.data;
  const canEdit = workspace.canAdmin;
  const github = destinations.find((d) => d.type === "github" && !d.repoId);
  const others = destinations.filter((d) => d.type !== "github");
  const repoName = (id: string | null) => (id ? repos.find((r) => r.id === id)?.fullName ?? "one repo" : "All repositories");

  return (
    <div className="stack">
      <PageHeader
        title="Destinations"
        description="Where each report goes. The PR only ever gets the public part; private destinations can get the full report."
        actions={
          canEdit && (
            <Button variant="primary" icon={<Plus />} onClick={() => setAdding(true)}>
              Add destination
            </Button>
          )
        }
      />

      <Panel title="On the pull request" flush>
        <div className="dest">
          <span className="dest-icon">{TYPES.github.icon}</span>
          <div className="dest-text">
            <div className="dest-title">
              PR comment <VisibilityTag visibility="public" />
            </div>
            <div className="dest-target">Only checks in live mode are posted. With every check in shadow mode, nothing appears on the PR.</div>
          </div>
          <div className="dest-actions">
            <Switch
              aria-label="Post on the PR"
              checked={github ? github.enabled : true}
              disabled={!canEdit}
              onChange={(v) => (github ? update.mutate({ id: github.id, enabled: v }) : createGithub.mutate(v))}
            />
          </div>
        </div>
      </Panel>

      <Panel title="For your team" description="Sent once per commit, after CI finishes, so the score is final." flush>
        {others.length === 0 ? (
          <EmptyState
            icon={<Hash />}
            title="No team destinations yet"
            action={
              canEdit && (
                <Button icon={<Plus />} onClick={() => setAdding(true)}>
                  Add destination
                </Button>
              )
            }
          >
            Send reports to Slack, Discord, email or your own webhook. This is how maintainers see shadow-mode results.
          </EmptyState>
        ) : (
          others.map((d) => (
            <DestinationRow
              key={d.id}
              d={d}
              repo={repoName(d.repoId)}
              canEdit={canEdit}
              onToggle={(enabled) => update.mutate({ id: d.id, enabled })}
              onRemove={() =>
                remove.mutate(d.id, {
                  onSuccess: () => toast("pass", `${TYPES[d.type].name} destination removed`),
                })
              }
            />
          ))
        )}
      </Panel>

      <AddDestination open={adding} onClose={() => setAdding(false)} repos={repos.map((r) => ({ id: r.id, name: r.fullName }))} />
    </div>
  );
}

function DestinationRow({ d, repo, canEdit, onToggle, onRemove }: { d: Destination; repo: string; canEdit: boolean; onToggle: (v: boolean) => void; onRemove: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const target =
    d.type === "slack" ? `Channel ${d.config.channel}` : d.type === "email" ? (d.config.to ?? []).join(", ") : d.type === "webhook" ? d.config.url : d.type === "discord" ? `Webhook ${d.secretHint ?? ""}` : "";
  return (
    <div className="dest">
      <span className="dest-icon">{TYPES[d.type].icon}</span>
      <div className="dest-text">
        <div className="dest-title">
          {TYPES[d.type].name}
          <VisibilityTag visibility={d.audience} />
        </div>
        <div className="dest-target">
          <span className="mono">{target}</span> · {repo}
        </div>
      </div>
      <div className="dest-actions">
        {confirming ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Keep
            </Button>
            <Button size="sm" variant="danger" onClick={onRemove}>
              Remove
            </Button>
          </>
        ) : (
          <>
            <Switch aria-label={`${TYPES[d.type].name} enabled`} checked={d.enabled} disabled={!canEdit} onChange={onToggle} />
            {canEdit && <Button size="sm" variant="ghost" icon={<Trash />} aria-label="Remove destination" onClick={() => setConfirming(true)} />}
          </>
        )}
      </div>
    </div>
  );
}

type TeamType = Exclude<DestinationType, "github">;

function AddDestination({ open, onClose, repos }: { open: boolean; onClose: () => void; repos: { id: string; name: string }[] }) {
  const toast = useToast();
  const [type, setType] = useState<TeamType>("slack");
  const [audience, setAudience] = useState<"maintainers" | "public">("maintainers");
  const [repoId, setRepoId] = useState("");
  const [f, setF] = useState({ channel: "", token: "", webhookUrl: "", to: "", url: "", signingSecret: "" });
  const create = useWorkspaceMutation((login, body: DestinationInput) => api(`/workspaces/${login}/destinations`, { method: "POST", body }));

  const body = (): DestinationInput => {
    const base = { audience, repoId: repoId || null };
    switch (type) {
      case "slack":
        return { type, ...base, channel: f.channel.trim(), token: f.token.trim() };
      case "discord":
        return { type, ...base, webhookUrl: f.webhookUrl.trim() };
      case "email":
        return { type, ...base, to: f.to.split(/[,\s]+/).filter(Boolean) };
      case "webhook":
        return { type, ...base, url: f.url.trim(), signingSecret: f.signingSecret.trim() || undefined };
    }
  };
  const ready =
    (type === "slack" && f.channel && f.token.startsWith("xoxb-")) ||
    (type === "discord" && f.webhookUrl.startsWith("https://")) ||
    (type === "email" && f.to.includes("@")) ||
    (type === "webhook" && f.url.startsWith("https://"));

  async function submit() {
    try {
      await create.mutateAsync(body());
      toast("pass", `${TYPES[type].name} destination added`);
      setF({ channel: "", token: "", webhookUrl: "", to: "", url: "", signingSecret: "" });
      onClose();
    } catch {
      /* shown inline below */
    }
  }
  const field = (k: keyof typeof f) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value }) });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={560}
      title="Add a destination"
      description="Credentials are encrypted when saved and are never shown again."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ready} loading={create.isPending} onClick={submit}>
            Add destination
          </Button>
        </>
      }
    >
      <div className="choices" role="radiogroup" aria-label="Destination type">
        {(Object.keys(TYPES) as DestinationType[])
          .filter((t): t is TeamType => t !== "github")
          .map((t) => (
            <button key={t} type="button" role="radio" aria-checked={type === t} className="choice" onClick={() => setType(t)}>
              <span className="choice-icon">{TYPES[t].icon}</span>
              <span className="choice-title">{TYPES[t].name}</span>
            </button>
          ))}
      </div>
      <p className="muted small">{TYPES[type].desc}</p>

      {type === "slack" && (
        <>
          <Field label="Bot token" hint="From your Slack app's OAuth page. Needs the chat:write scope, and the app must be in the channel.">
            {(p) => <Input {...p} {...field("token")} mono type="password" autoComplete="off" placeholder="xoxb-…" />}
          </Field>
          <Field label="Channel ID" hint="In Slack: open the channel details, the ID is at the bottom.">
            {(p) => <Input {...p} {...field("channel")} mono placeholder="C04ABCDEF12" />}
          </Field>
        </>
      )}
      {type === "discord" && (
        <Field label="Channel webhook URL" hint="Channel settings → Integrations → Webhooks → New webhook → Copy URL.">
          {(p) => <Input {...p} {...field("webhookUrl")} mono type="password" autoComplete="off" placeholder="https://discord.com/api/webhooks/…" />}
        </Field>
      )}
      {type === "email" && (
        <Field label="Send to" hint="Separate addresses with commas.">
          {(p) => <Input {...p} {...field("to")} placeholder="maintainers@yourproject.org" />}
        </Field>
      )}
      {type === "webhook" && (
        <>
          <Field label="URL" hint="Must use https and a public address.">
            {(p) => <Input {...p} {...field("url")} mono placeholder="https://hooks.yourcompany.com/proof" />}
          </Field>
          <Field label="Signing secret" optional hint="PRoof signs each request (X-Proof-Signature) so you can check it came from us. At least 16 characters.">
            {(p) => <Input {...p} {...field("signingSecret")} mono type="password" autoComplete="off" />}
          </Field>
        </>
      )}

      <div className="field">
        <span className="field-label">What to send</span>
        <Segmented<"maintainers" | "public">
          label="What to send"
          value={audience}
          onChange={setAudience}
          options={[
            { value: "maintainers", label: "Full report", icon: <EyeOff />, tone: "private" },
            { value: "public", label: "Public part only", icon: <Globe /> },
          ]}
        />
        <p className="field-hint">
          {audience === "maintainers"
            ? "Includes shadow-mode checks and contributor context. Use for channels only maintainers can read."
            : "Exactly what's on the PR. Safe for public community channels."}
        </p>
      </div>

      <Field label="Repositories">
        {(p) => (
          <Select {...p} value={repoId} onChange={(e) => setRepoId(e.target.value)}>
            <option value="">All repositories</option>
            {repos.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {create.error && <Callout tone="fail">{create.error instanceof ApiError ? create.error.message : "Couldn't add the destination."}</Callout>}
    </Dialog>
  );
}
