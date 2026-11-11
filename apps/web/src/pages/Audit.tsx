import { ScrollText } from "lucide-react";
import { timeAgo, useAudit } from "../lib/hooks";
import { Avatar, EmptyState, PageHeader, Panel, Skeleton } from "../components/Layout";
import "./pages.css";

const ACTIONS: Record<string, string> = {
  "settings.update": "changed workspace checks",
  "repo.settings.update": "changed overrides for",
  "repo.enable": "turned on",
  "repo.disable": "paused",
  "ai.update": "changed the AI model",
  "ai.update+key": "set the AI model and key",
  "ai.remove": "turned off AI",
  "destination.create": "added a destination:",
  "destination.update": "changed a destination:",
  "destination.delete": "removed a destination:",
  "external-check.secret": "set the signing secret for",
};

export function Audit() {
  const { data, isLoading } = useAudit();
  return (
    <div className="stack">
      <PageHeader title="Audit log" description="Every change to this workspace, who made it, and when. Kept for the life of the workspace." />
      <Panel flush>
        {isLoading ? (
          <div className="stack-sm" style={{ padding: 18 }}>
            <Skeleton height={20} />
            <Skeleton height={20} />
            <Skeleton height={20} />
          </div>
        ) : !data?.entries.length ? (
          <EmptyState icon={<ScrollText />} title="No changes yet">
            Changes to checks, destinations, the AI model and repositories show up here.
          </EmptyState>
        ) : (
          <div className="audit">
            {data.entries.map((e, i) => (
              <div key={i} className="audit-row">
                <Avatar src={e.avatar} name={e.actor ?? "?"} size={22} />
                <span>
                  <strong style={{ fontWeight: 580 }}>{e.actor ?? "Someone"}</strong> {ACTIONS[e.action] ?? e.action}
                  {e.target && <span className="mono"> {e.target}</span>}
                </span>
                <time className="audit-time" dateTime={e.at} title={new Date(e.at).toLocaleString()}>
                  {timeAgo(e.at)}
                </time>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
