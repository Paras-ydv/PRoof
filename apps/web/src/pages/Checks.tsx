import { useEffect, useMemo, useState, type ReactNode } from "react";
import { MessageCircleQuestionMark, Plus, Sparkles, Trash } from "lucide-react";
import { ApiError } from "../api/client";
import type { CustomRule, Settings, SettingsPatch } from "../api/types";
import { useSaveSettings, useWorkspace } from "../lib/hooks";
import { diff, same } from "../lib/diff";
import { CONTEXT_CHECKS, SCORED_CHECKS } from "../lib/checks";
import { Button } from "../components/Button";
import { Field, Input, Segmented, Select, Switch, Textarea } from "../components/Form";
import { MODE_OPTIONS, type Mode } from "../components/modes";
import { Callout, Dialog, PageHeader, Panel, Skeleton, useToast } from "../components/Layout";
import { Badge, ModeTag } from "../components/Status";
import "./pages.css";


export function Checks() {
  const ws = useWorkspace();
  const save = useSaveSettings();
  const toast = useToast();
  const [draft, setDraft] = useState<Settings | null>(null);
  const [ruleOpen, setRuleOpen] = useState(false);

  const saved = ws.data?.workspace.effective ?? null;
  useEffect(() => {
    if (saved && !draft) setDraft(structuredClone(saved));
  }, [saved, draft]);

  const dirty = useMemo(() => !!draft && !!saved && !same(draft, saved), [draft, saved]);
  if (ws.isLoading || !draft || !ws.data) return <Skeleton height={400} radius={11} />;
  const canEdit = ws.data.workspace.canAdmin;
  const defaults = ws.data.workspace.defaults;

  const set = (fn: (s: Settings) => void) =>
    setDraft((d) => {
      const next = structuredClone(d!);
      fn(next);
      return next;
    });

  const scoredTotal = SCORED_CHECKS.filter((c) => draft.checks[c.id] !== "off").reduce((n, c) => n + draft.weights[c.id], 0) + (draft.questions.mode !== "off" ? draft.weights.questions : 0) + draft.customRules.filter((r) => r.kind === "scored" && r.mode !== "off").reduce((n, r) => n + r.weight, 0);

  async function onSave() {
    const patch = (diff(defaults, draft) ?? {}) as SettingsPatch;
    try {
      await save.mutateAsync(patch);
      toast("pass", "Checks saved. They apply from the next push.");
      setDraft(null);
    } catch (err) {
      toast("fail", err instanceof ApiError ? err.message : "Couldn't save. Try again.");
    }
  }

  return (
    <div className="stack">
      <PageHeader
        title="Checks & scoring"
        description="What PRoof looks at on every PR, who sees each result, and how much it counts. Repos can override these."
      />
      {!canEdit && <Callout tone="info">Only {ws.data.workspace.login} org owners can change these. You can see everything.</Callout>}

      <ModeLegend />

      <Panel
        title="Readiness score"
        description="Each check earns a share of its points. Checks that don't apply to a PR drop out, and the rest scale back to 100."
        actions={<Badge tone="neutral">{scoredTotal} points in play</Badge>}
        flush
      >
        <div className="setting-list">
          {SCORED_CHECKS.map((c) => (
            <Setting key={c.id} title={c.title} desc={c.desc} badge={<ModeTag mode={draft.checks[c.id]} />}>
              <WeightInput value={draft.weights[c.id]} disabled={!canEdit || draft.checks[c.id] === "off"} onChange={(v) => set((s) => void (s.weights[c.id] = v))} />
              <Segmented<Mode> label={`${c.title} mode`} value={draft.checks[c.id]} options={MODE_OPTIONS} disabled={!canEdit} onChange={(m) => set((s) => void (s.checks[c.id] = m))} />
            </Setting>
          ))}
        </div>
      </Panel>

      <Panel title="Understanding questions" description="PRoof asks the author short questions on lines they changed. Answers are written in the PR thread." flush>
        <div className="setting-list">
          <Setting title="Questions" desc="Ask only: you read the answers yourself. Ask and review: the AI also checks each answer against the code and quotes it. Needs an AI model.">
            <Segmented<Settings["questions"]["mode"]>
              label="Questions mode"
              value={draft.questions.mode}
              disabled={!canEdit}
              onChange={(m) => set((s) => void (s.questions.mode = m))}
              options={[
                { value: "off", label: "Off", tone: "muted" },
                { value: "askOnly", label: "Ask only" },
                { value: "askAndReview", label: "Ask and review", icon: <Sparkles /> },
              ]}
            />
          </Setting>
          {draft.questions.mode !== "off" && (
            <>
              <Setting title="Questions per PR" desc="Fewer questions means less friction for contributors.">
                <Segmented<string>
                  size="sm"
                  label="Questions per PR"
                  value={String(draft.questions.count)}
                  disabled={!canEdit}
                  onChange={(v) => set((s) => void (s.questions.count = Number(v)))}
                  options={[1, 2, 3].map((n) => ({ value: String(n), label: String(n) }))}
                />
              </Setting>
              <Setting title="Points" desc="Only counted in Ask and review mode. Unanswered questions don't cost points during the grace period.">
                <WeightInput value={draft.weights.questions} disabled={!canEdit || draft.questions.mode !== "askAndReview"} onChange={(v) => set((s) => void (s.weights.questions = v))} />
              </Setting>
              <Setting title="Grace period" desc="Days an unanswered question waits before it counts against the score.">
                <Input type="number" min={0} max={30} className="weight-input" value={draft.questions.graceDays} disabled={!canEdit} onChange={(e) => set((s) => void (s.questions.graceDays = clamp(e.target.valueAsNumber, 0, 30)))} aria-label="Grace period in days" />
              </Setting>
            </>
          )}
          <Setting title="PR summary" desc="One or two plain sentences on what the change does, at the top of every report.">
            <Switch checked={draft.summary.enabled} disabled={!canEdit} aria-label="PR summary" onChange={(v) => set((s) => void (s.summary.enabled = v))} />
          </Setting>
        </div>
      </Panel>

      <Panel title="About the contributor" description="Evidence about the person, for maintainers only. It never changes the score and is never posted on the PR." flush>
        <div className="setting-list">
          {CONTEXT_CHECKS.map((c) => (
            <Setting key={c.id} title={c.title} desc={c.desc}>
              <Switch checked={draft.checks[c.id] !== "off"} disabled={!canEdit} aria-label={c.title} onChange={(v) => set((s) => void (s.checks[c.id] = v ? "shadow" : "off"))} />
            </Setting>
          ))}
          {draft.checks.spray !== "off" && (
            <Setting title="Spray threshold" desc="Flag when the author opened PRs to at least this many unrelated repos within the window.">
              <Input type="number" min={2} className="weight-input" value={draft.thresholds.sprayRepos} disabled={!canEdit} onChange={(e) => set((s) => void (s.thresholds.sprayRepos = clamp(e.target.valueAsNumber, 2, 500)))} aria-label="Repos" />
              <span className="muted small">repos in</span>
              <Input type="number" min={1} className="weight-input" value={draft.thresholds.sprayWindowHours} disabled={!canEdit} onChange={(e) => set((s) => void (s.thresholds.sprayWindowHours = clamp(e.target.valueAsNumber, 1, 720)))} aria-label="Hours" />
              <span className="muted small">hours</span>
            </Setting>
          )}
        </div>
      </Panel>

      <Panel title="Claims" description="Contributors comment /claim on an issue to take it. Quiet claims get a reminder, then are released for someone else." flush>
        <div className="setting-list">
          <Setting title="Claim commands" desc="Turn on /claim and /unclaim for issues.">
            <Switch checked={draft.checks.claims !== "off"} disabled={!canEdit} aria-label="Claims" onChange={(v) => set((s) => void (s.checks.claims = v ? "live" : "off"))} />
          </Setting>
          {draft.checks.claims !== "off" && (
            <>
              <Setting title="Remind after" desc="Days without activity before PRoof checks in with the claimer.">
                <Input type="number" min={1} className="weight-input" value={draft.claims.remindAfterDays} disabled={!canEdit} onChange={(e) => set((s) => void (s.claims.remindAfterDays = clamp(e.target.valueAsNumber, 1, 90)))} aria-label="Remind after days" />
                <span className="muted small">days</span>
              </Setting>
              <Setting title="Release after" desc="Days without activity before the claim is released.">
                <Input type="number" min={1} className="weight-input" value={draft.claims.releaseAfterDays} disabled={!canEdit} onChange={(e) => set((s) => void (s.claims.releaseAfterDays = clamp(e.target.valueAsNumber, 1, 180)))} aria-label="Release after days" />
                <span className="muted small">days</span>
              </Setting>
              <Setting title="Assign on claim" desc="Also assign the issue to the claimer on GitHub, so the linked-issue check can see it.">
                <Switch checked={draft.claims.assignOnClaim} disabled={!canEdit} aria-label="Assign on claim" onChange={(v) => set((s) => void (s.claims.assignOnClaim = v))} />
              </Setting>
            </>
          )}
        </div>
      </Panel>

      <Panel
        title="Your own rules"
        description="Rules specific to your org, with no code needed. Need something these can't express? Use Request a feature in the sidebar."
        actions={
          canEdit && (
            <Button size="sm" icon={<Plus />} onClick={() => setRuleOpen(true)}>
              Add rule
            </Button>
          )
        }
        flush
      >
        {draft.customRules.length === 0 ? (
          <p className="muted small" style={{ padding: 18 }}>
            No custom rules yet. Examples: require a conventional commit title, block changes to vendor/, or require tests when src/api changes.
          </p>
        ) : (
          <div className="setting-list">
            {draft.customRules.map((r, i) => (
              <Setting key={r.id} title={r.title} desc={describeRule(r)} badge={r.kind === "context" ? <Badge tone="private">Maintainers only</Badge> : <Badge>{r.weight} pts</Badge>}>
                <Segmented<Mode> label={`${r.title} mode`} value={r.mode} options={MODE_OPTIONS} disabled={!canEdit} onChange={(m) => set((s) => void (s.customRules[i]!.mode = m))} />
                {canEdit && <Button variant="ghost" size="sm" icon={<Trash />} aria-label={`Remove ${r.title}`} onClick={() => set((s) => void s.customRules.splice(i, 1))} />}
              </Setting>
            ))}
          </div>
        )}
      </Panel>

      {dirty && (
        <div className="savebar" role="region" aria-label="Unsaved changes">
          <span className="savebar-text">
            <span className="savebar-dot" />
            Unsaved changes
          </span>
          <span className="row">
            <Button variant="ghost" onClick={() => setDraft(structuredClone(saved!))}>
              Discard
            </Button>
            <Button variant="primary" loading={save.isPending} onClick={onSave}>
              Save changes
            </Button>
          </span>
        </div>
      )}

      <RuleDialog
        open={ruleOpen}
        onClose={() => setRuleOpen(false)}
        existing={draft.customRules.map((r) => r.id)}
        onAdd={(rule) => {
          set((s) => void s.customRules.push(rule));
          setRuleOpen(false);
        }}
      />
    </div>
  );
}

function ModeLegend() {
  return (
    <div className="grid-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
      {[
        { mode: "off" as const, text: "Doesn't run." },
        { mode: "shadow" as const, text: "Runs on every PR. Only maintainers see the result. Start here." },
        { mode: "live" as const, text: "Shown on the PR and counted in the score the author sees." },
      ].map((m) => (
        <div key={m.mode} className="row small" style={{ alignItems: "flex-start", flexWrap: "nowrap", gap: 10, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface)" }}>
          <ModeTag mode={m.mode} />
          <span className="muted">{m.text}</span>
        </div>
      ))}
    </div>
  );
}

export function Setting({ title, desc, badge, children }: { title: string; desc: ReactNode; badge?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting">
      <div className="setting-text">
        <div className="setting-title">
          {title}
          {badge}
        </div>
        <div className="setting-desc">{desc}</div>
      </div>
      <div className="setting-controls">{children}</div>
    </div>
  );
}

function WeightInput({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return <Input type="number" min={0} max={100} className="weight-input tabular" value={value} disabled={disabled} onChange={(e) => onChange(clamp(e.target.valueAsNumber, 0, 100))} aria-label="Points" suffix="pts" />;
}

const clamp = (n: number, min: number, max: number) => (Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : min);

function describeRule(r: CustomRule): string {
  const c = r.condition;
  switch (c.type) {
    case "titleMatches":
      return `Title matches /${c.pattern}/`;
    case "bodyContains":
      return `Description contains "${c.text}"`;
    case "requireLabel":
      return `Has one of: ${c.anyOf.join(", ")}`;
    case "forbidPaths":
      return `Doesn't change ${c.globs.join(", ")}`;
    case "pathsNeedTests":
      return `Changes to ${c.globs.join(", ")} need tests`;
    case "maxFiles":
      return `At most ${c.max} files changed`;
  }
}

type RuleType = CustomRule["condition"]["type"];
const RULE_TYPES: { value: RuleType; label: string; field: string; placeholder: string }[] = [
  { value: "titleMatches", label: "Title matches a pattern", field: "Pattern (regular expression)", placeholder: "^(feat|fix|docs|chore)(\\(.+\\))?: " },
  { value: "bodyContains", label: "Description contains text", field: "Text", placeholder: "Signed-off-by" },
  { value: "requireLabel", label: "Has one of these labels", field: "Labels, comma separated", placeholder: "bug, enhancement, docs" },
  { value: "forbidPaths", label: "Doesn't change protected paths", field: "Paths, comma separated", placeholder: "vendor/**, .github/workflows/**" },
  { value: "pathsNeedTests", label: "Paths need tests", field: "Paths, comma separated", placeholder: "src/api/**" },
  { value: "maxFiles", label: "Limit files changed", field: "Maximum files", placeholder: "40" },
];

function RuleDialog({ open, onClose, onAdd, existing }: { open: boolean; onClose: () => void; onAdd: (r: CustomRule) => void; existing: string[] }) {
  const [type, setType] = useState<RuleType>("titleMatches");
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [kind, setKind] = useState<"scored" | "context">("scored");
  const [weight, setWeight] = useState(5);
  const [howToFix, setHowToFix] = useState("");
  const meta = RULE_TYPES.find((t) => t.value === type)!;
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const list = value.split(",").map((s) => s.trim()).filter(Boolean);

  let error: string | null = null;
  if (id.length < 2) error = "Give the rule a name";
  else if (existing.includes(id)) error = "A rule with this name already exists";
  else if (!value.trim()) error = "Fill in the rule";
  else if (type === "titleMatches") {
    try {
      new RegExp(value);
    } catch {
      error = "That isn't a valid regular expression";
    }
  } else if (type === "maxFiles" && !(Number(value) >= 1)) error = "Enter a number of files";

  const condition = (): CustomRule["condition"] => {
    switch (type) {
      case "titleMatches":
        return { type, pattern: value };
      case "bodyContains":
        return { type, text: value.trim() };
      case "requireLabel":
        return { type, anyOf: list };
      case "forbidPaths":
        return { type, globs: list };
      case "pathsNeedTests":
        return { type, globs: list };
      case "maxFiles":
        return { type, max: Math.round(Number(value)) };
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a rule"
      description="New rules start in shadow mode, so you can see what they'd flag before contributors do."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!!error}
            onClick={() => {
              onAdd({ id, title: title.trim(), mode: "shadow", kind, weight: kind === "scored" ? weight : 0, condition: condition(), howToFix: howToFix.trim() });
              setTitle("");
              setValue("");
              setHowToFix("");
            }}
          >
            Add rule
          </Button>
        </>
      }
    >
      <Field label="Name">{(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Conventional title" maxLength={60} />}</Field>
      <Field label="Rule">
        {(p) => (
          <Select {...p} value={type} onChange={(e) => (setType(e.target.value as RuleType), setValue(""))}>
            {RULE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={meta.field} hint={type === "forbidPaths" || type === "pathsNeedTests" ? "Globs: ** matches any folders, * matches within one." : undefined}>
        {(p) => <Input {...p} mono value={value} onChange={(e) => setValue(e.target.value)} placeholder={meta.placeholder} />}
      </Field>
      <div className="field">
        <span className="field-label">Counts toward</span>
        <Segmented<"scored" | "context">
          label="Counts toward"
          value={kind}
          onChange={setKind}
          options={[
            { value: "scored", label: "The score" },
            { value: "context", label: "Maintainer notes only", tone: "private" },
          ]}
        />
      </div>
      {kind === "scored" && (
        <Field label="Points">{(p) => <Input {...p} type="number" min={0} max={100} value={weight} onChange={(e) => setWeight(clamp(e.target.valueAsNumber, 0, 100))} style={{ width: 100 }} />}</Field>
      )}
      <Field label="How to fix" optional hint="Shown to the author when the rule isn't met. Say what to do, not what went wrong.">
        {(p) => <Textarea {...p} rows={2} value={howToFix} onChange={(e) => setHowToFix(e.target.value)} placeholder='Start the title with a type, like "fix(parser): handle empty input".' maxLength={500} />}
      </Field>
      {error && title && <p className="field-error">{error}</p>}
      <p className="dialog-note row" style={{ gap: 6 }}>
        <MessageCircleQuestionMark size={13} /> Rule id: <code>{id || "…"}</code>
      </p>
    </Dialog>
  );
}
