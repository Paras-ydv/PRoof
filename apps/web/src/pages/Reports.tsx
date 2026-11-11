import { useMemo, useState } from "react";
import { Link } from "react-router";
import { ArrowUpRight, Inbox } from "lucide-react";
import { timeAgo, useLogin, useReports, useWorkspace } from "../lib/hooks";
import { Segmented, Select } from "../components/Form";
import { Callout, EmptyState, PageHeader, Panel, Skeleton } from "../components/Layout";
import { ScoreBar } from "../components/Score";
import { Badge } from "../components/Status";
import "../components/table.css";
import "./pages.css";

type Filter = "all" | "attention" | "ready";

export function Reports() {
  const login = useLogin();
  const [repo, setRepo] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const ws = useWorkspace();
  const { data, isLoading, error } = useReports(repo || undefined);

  const rows = useMemo(() => {
    const all = data?.reports ?? [];
    if (filter === "attention") return all.filter((r) => (r.scoreFull ?? 100) < 80 || r.flags > 0);
    if (filter === "ready") return all.filter((r) => (r.scoreFull ?? 0) >= 80 && r.flags === 0);
    return all;
  }, [data, filter]);

  return (
    <>
      <PageHeader title="Reports" description="One report per pull request, updated on every push. Newest first." />
      <div className="filters">
        <Segmented<Filter>
          label="Filter reports"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "attention", label: "Needs attention" },
            { value: "ready", label: "Ready" },
          ]}
        />
        <Select aria-label="Repository" value={repo} onChange={(e) => setRepo(e.target.value)}>
          <option value="">All repositories</option>
          {ws.data?.repos.map((r) => (
            <option key={r.id} value={r.fullName}>
              {r.fullName}
            </option>
          ))}
        </Select>
      </div>
      {error && <Callout tone="fail">{error.message}</Callout>}
      <Panel flush>
        {isLoading ? (
          <div className="stack-sm" style={{ padding: 18 }}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={32} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Inbox />} title={filter === "all" ? "No reports yet" : "Nothing here"}>
            {filter === "all" ? "Reports appear when a pull request is opened or updated in a connected repository." : "No reports match this filter."}
          </EmptyState>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Pull request</th>
                <th>Author</th>
                <th>Flags</th>
                <th>Score</th>
                <th className="num">Updated</th>
                <th>
                  <span className="visually-hidden">GitHub</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="table-link-row">
                  <td style={{ width: "100%" }}>
                    <Link to={`/w/${login}/reports/${r.id}`} className="cell-title">
                      <span className="cell-title-main">{r.title}</span>
                      <span className="cell-title-sub mono">
                        {r.repo} #{r.prNumber}
                      </span>
                    </Link>
                  </td>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{r.author}</td>
                  <td>{r.pending ? <Badge tone="pending">Running</Badge> : r.flags > 0 ? <Badge tone="warn">{r.flags}</Badge> : <Badge tone="pass">0</Badge>}</td>
                  <td>
                    <ScoreBar value={r.scoreFull} />
                  </td>
                  <td className="num muted" style={{ whiteSpace: "nowrap" }}>
                    {timeAgo(r.updatedAt)}
                  </td>
                  <td>
                    <a
                      className="btn btn-ghost btn-sm btn-square"
                      href={`https://github.com/${r.repo}/pull/${r.prNumber}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`View ${r.repo} #${r.prNumber} on GitHub`}
                      title="View on GitHub"
                    >
                      <span className="btn-icon">
                        <ArrowUpRight />
                      </span>
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
