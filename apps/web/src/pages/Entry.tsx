import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { ArrowRight, EyeOff, FileSearch, Hourglass, LogIn, Plus, ShieldCheck, UserX } from "lucide-react";
import { ApiError, DEMO, signInUrl } from "../api/client";
import { useMe, useMeta, useWorkspaces } from "../lib/hooks";
import { Button, ButtonLink } from "../components/Button";
import { Avatar, Callout, EmptyState, Panel, Skeleton } from "../components/Layout";
import { Logo } from "../components/Logo";
import "./pages.css";

export function SignIn() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const returnTo = params.get("return_to") ?? "/workspaces";
  const error = params.get("error");
  return (
    <div className="centered">
      <div className="centered-card">
        <Link to="/" aria-label="PRoof home" style={{ color: "var(--text)" }}>
          <Logo size={28} />
        </Link>
        <div className="signin-hero">
          <h1 className="signin-title">Review the PRs that are ready.</h1>
          <p className="signin-lede">PRoof checks every pull request before you open it and shows you the evidence, not a verdict.</p>
        </div>
        {error && <Callout tone="fail" title="Sign-in didn't finish">{error}</Callout>}
        <ul className="signin-points">
          <li>
            <FileSearch />
            <span>A summary and a readiness score on each PR, with the reason behind every flag.</span>
          </li>
          <li>
            <EyeOff />
            <span>Starts in shadow mode: only maintainers see results until you choose to go live.</span>
          </li>
          <li>
            <ShieldCheck />
            <span>Never closes or rejects a PR. Maintainers decide.</span>
          </li>
        </ul>
        {DEMO ? (
          <Button variant="primary" icon={<LogIn />} onClick={() => navigate("/w/lumen-labs")}>
            Open the demo workspace
          </Button>
        ) : (
          <Button variant="primary" icon={<LogIn />} onClick={() => (window.location.href = signInUrl(returnTo))}>
            Continue with GitHub
          </Button>
        )}
        <p className="signin-foot">
          PRoof only asks GitHub who you are. What you can change here always matches your role on GitHub.
        </p>
      </div>
    </div>
  );
}

/** "/" — send people to their workspace, or explain how to get one. */
export function Home() {
  const me = useMe();
  const ws = useWorkspaces();
  const installUrl = useMeta().data?.installUrl ?? "https://github.com/apps";
  if (me.error instanceof ApiError && me.error.status === 401) return <Navigate to="/signin" replace />;
  if (ws.data?.workspaces.length === 1) return <Navigate to={`/w/${ws.data.workspaces[0]!.login}`} replace />;

  return (
    <div className="centered">
      <div className="centered-card" style={{ width: "min(520px, 100%)" }}>
        <Logo size={26} />
        <Panel title="Choose a workspace" description="Each GitHub organization or account where PRoof is installed has one workspace.">
          {ws.isLoading ? (
            <div className="stack-sm">
              <Skeleton height={36} />
              <Skeleton height={36} />
            </div>
          ) : ws.data && ws.data.workspaces.length > 0 ? (
            <div className="stack-sm">
              {ws.data.workspaces.map((w) => (
                <ButtonLink key={w.login} to={`/w/${w.login}`} trailing={<ArrowRight />} className="ws-choice">
                  <span className="row">
                    <Avatar src={`https://github.com/${w.login}.png?size=64`} name={w.login} size={20} square />
                    {w.login}
                  </span>
                </ButtonLink>
              ))}
              <ButtonLink to={installUrl} variant="ghost" icon={<Plus />}>
                Install on another organization
              </ButtonLink>
            </div>
          ) : (
            <EmptyState
              icon={<Plus />}
              title="Install PRoof on GitHub"
              action={
                <ButtonLink variant="primary" to={installUrl} trailing={<ArrowRight />}>
                  Install on GitHub
                </ButtonLink>
              }
            >
              GitHub asks you to pick the organization and repositories. Only org owners can install it, so nobody else can connect your org.
            </EmptyState>
          )}
        </Panel>
      </div>
    </div>
  );
}

/** Where GitHub's setup redirect lands when the install isn't finished or isn't theirs. */
export function SetupStatus({ kind }: { kind: "requested" | "not-yours" }) {
  return (
    <div className="centered">
      <div className="centered-card">
        <Logo size={26} />
        {kind === "requested" ? (
          <Callout tone="info" title="Request sent to your org owners">
            <span className="row">
              <Hourglass size={14} />
              GitHub has asked an owner of the organization to approve PRoof. You'll get access as soon as they install it.
            </span>
          </Callout>
        ) : (
          <Callout tone="warn" title="This installation isn't linked to your GitHub account">
            <span className="row">
              <UserX size={14} />
              Sign in with an account that has access to the organization, or ask an org owner to install PRoof.
            </span>
          </Callout>
        )}
        <ButtonLink to="/workspaces" variant="secondary">
          Back to workspaces
        </ButtonLink>
      </div>
    </div>
  );
}
