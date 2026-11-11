import { useEffect, useState } from "react";
import { Bot, Cpu, KeyRound, Lock, Server } from "lucide-react";
import { api, ApiError } from "../api/client";
import type { Provider } from "../api/types";
import { formatNumber, useUsage, useWorkspace, useWorkspaceMutation } from "../lib/hooks";
import { Button } from "../components/Button";
import { Field, Input } from "../components/Form";
import { Callout, PageHeader, Panel, Skeleton, useToast } from "../components/Layout";
import { Badge } from "../components/Status";
import "./pages.css";

const PROVIDERS: Record<Provider, { name: string; icon: React.ReactNode; desc: string; model: string; keyPlaceholder: string }> = {
  anthropic: { name: "Anthropic", icon: <Bot />, desc: "Claude models. Recommended default.", model: "claude-opus-5-5", keyPlaceholder: "sk-ant-…" },
  openai: { name: "OpenAI", icon: <Cpu />, desc: "OpenAI's hosted models.", model: "", keyPlaceholder: "sk-…" },
  "openai-compatible": { name: "Self-hosted", icon: <Server />, desc: "Any OpenAI-compatible endpoint: vLLM, Ollama, OpenRouter.", model: "", keyPlaceholder: "Key for your endpoint" },
};

const TASKS: Record<string, string> = { summary: "PR summaries", questions: "Writing questions", review: "Reviewing answers", ask: "@proof questions" };

export function Ai() {
  const ws = useWorkspace();
  const usage = useUsage();
  const toast = useToast();
  const current = ws.data?.workspace.ai ?? null;
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [model, setModel] = useState(PROVIDERS.anthropic.model);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [cap, setCap] = useState("");
  const [replacingKey, setReplacingKey] = useState(false);

  useEffect(() => {
    if (!current) return;
    setProvider(current.provider);
    setModel(current.model);
    setBaseUrl(current.baseUrl ?? "");
    setCap(current.monthlyTokenCap ? String(current.monthlyTokenCap) : "");
  }, [current]);

  const save = useWorkspaceMutation((login, body: unknown) => api(`/workspaces/${login}/ai`, { method: "PUT", body }));
  const remove = useWorkspaceMutation((login) => api(`/workspaces/${login}/ai`, { method: "DELETE" }));

  if (ws.isLoading || !ws.data) return <Skeleton height={320} radius={11} />;
  const canEdit = ws.data.workspace.canAdmin;
  const hasKey = !!current?.keyHint;
  const needsKey = !hasKey || replacingKey || current?.provider !== provider;

  async function onSave() {
    try {
      await save.mutateAsync({
        provider,
        model: model.trim(),
        baseUrl: provider === "openai-compatible" ? baseUrl.trim() : undefined,
        monthlyTokenCap: cap ? Number(cap) : undefined,
        apiKey: apiKey.trim() || undefined,
      });
      setApiKey("");
      setReplacingKey(false);
      toast("pass", "AI model saved");
    } catch {
      /* shown inline */
    }
  }

  const totalTokens = (usage.data?.tasks ?? []).reduce((n, t) => n + t.inputTokens + t.outputTokens, 0);

  return (
    <div className="stack">
      <PageHeader title="AI model" description="Used for PR summaries and understanding questions. Every check works without it; the scoring itself never uses AI." />

      <div className="grid-main-side">
        <Panel
          title="Provider"
          description="You bring the key, so you choose the model and pay your provider directly."
          footer={
            canEdit && (
              <>
                {current && (
                  <Button variant="danger" onClick={() => remove.mutate(undefined, { onSuccess: () => toast("pass", "AI turned off. Checks keep running.") })}>
                    Turn off AI
                  </Button>
                )}
                <Button
                  variant="primary"
                  loading={save.isPending}
                  disabled={!model.trim() || (needsKey && apiKey.trim().length < 8) || (provider === "openai-compatible" && !baseUrl.startsWith("http"))}
                  onClick={onSave}
                >
                  {current ? "Save changes" : "Turn on AI"}
                </Button>
              </>
            )
          }
        >
          <div className="stack">
            <div className="choices" role="radiogroup" aria-label="AI provider">
              {(Object.keys(PROVIDERS) as Provider[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={provider === p}
                  className="choice"
                  disabled={!canEdit}
                  onClick={() => {
                    setProvider(p);
                    if (p !== current?.provider) setModel(PROVIDERS[p].model);
                  }}
                >
                  <span className="choice-icon">{PROVIDERS[p].icon}</span>
                  <span className="choice-title">{PROVIDERS[p].name}</span>
                  <span className="choice-desc">{PROVIDERS[p].desc}</span>
                </button>
              ))}
            </div>

            <Field label="Model" hint={provider === "anthropic" ? "claude-opus-5-5 is the default. Any model id your key can use works." : "The exact model id your provider expects."}>
              {(p) => <Input {...p} mono value={model} disabled={!canEdit} onChange={(e) => setModel(e.target.value)} placeholder={provider === "anthropic" ? "claude-opus-5-5" : "model-id"} />}
            </Field>

            {provider === "openai-compatible" && (
              <Field label="Base URL" hint="The endpoint's /v1 URL.">
                {(p) => <Input {...p} mono value={baseUrl} disabled={!canEdit} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://llm.internal.example.com/v1" />}
              </Field>
            )}

            {hasKey && !needsKey ? (
              <div className="field">
                <span className="field-label">API key</span>
                <div className="row" style={{ justifyContent: "space-between", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface-2)" }}>
                  <span className="row mono" style={{ gap: 8 }}>
                    <Lock size={13} /> {current!.keyHint}
                  </span>
                  {canEdit && (
                    <Button size="sm" variant="ghost" icon={<KeyRound />} onClick={() => setReplacingKey(true)}>
                      Replace
                    </Button>
                  )}
                </div>
                <p className="field-hint">Encrypted at rest. PRoof can use it but can't show it to anyone, including you.</p>
              </div>
            ) : (
              <Field label="API key" hint="Encrypted when saved and never shown again.">
                {(p) => <Input {...p} mono type="password" autoComplete="off" value={apiKey} disabled={!canEdit} onChange={(e) => setApiKey(e.target.value)} placeholder={PROVIDERS[provider].keyPlaceholder} />}
              </Field>
            )}

            <Field label="Monthly token limit" optional hint="PRoof stops calling the model for the rest of the month once this many tokens are used. Checks keep running.">
              {(p) => <Input {...p} type="number" min={0} value={cap} disabled={!canEdit} onChange={(e) => setCap(e.target.value)} placeholder="No limit" suffix="tokens" />}
            </Field>
            {save.error && <Callout tone="fail">{save.error instanceof ApiError ? save.error.message : "Couldn't save."}</Callout>}
          </div>
        </Panel>

        <Panel title="This month" description={current ? undefined : "Turn on AI to see usage here."}>
          {usage.isLoading ? (
            <Skeleton height={80} />
          ) : (
            <div className="stack-sm">
              {usage.data?.cap ? (
                <div className="meter">
                  <div className="meter-head">
                    <span className="tabular">{formatNumber(totalTokens)} tokens</span>
                    <span className="muted tabular">of {formatNumber(usage.data.cap)}</span>
                  </div>
                  <div className="meter-track">
                    <span className="meter-fill" style={{ width: `${Math.min(100, (totalTokens / usage.data.cap) * 100)}%` }} />
                  </div>
                </div>
              ) : (
                <div className="stat-value tabular" style={{ fontSize: "var(--text-xl)" }}>
                  {formatNumber(totalTokens)} <span className="muted small">tokens</span>
                </div>
              )}
              {(usage.data?.tasks ?? []).map((t) => (
                <div key={t.task} className="row small" style={{ justifyContent: "space-between" }}>
                  <span>{TASKS[t.task] ?? t.task}</span>
                  <span className="row muted tabular" style={{ gap: 8 }}>
                    {formatNumber(t.inputTokens + t.outputTokens)}
                    <Badge>{t.calls}×</Badge>
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Callout tone="private" title="What the model sees">
        The PR's title, description and diff, plus the author's answers to questions. Contributor history and spray data are never sent. PR text is treated as untrusted, so instructions hidden in a PR can't change the result.
      </Callout>
    </div>
  );
}
