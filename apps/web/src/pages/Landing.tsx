import { Link } from "react-router";
import {
  ArrowRight,
  BookOpen,
  Bot,
  EyeOff,
  FileSearch,
  GitPullRequest,
  Hash,
  Lock,
  Mail,
  MessageCircle,
  MessageCircleQuestionMark,
  Radio,
  ScrollText,
  ShieldCheck,
  Webhook,
} from "lucide-react";
import { DEMO, signInUrl } from "../api/client";
import { useMe, useMeta } from "../lib/hooks";
import { ButtonLink } from "../components/Button";
import { Logo } from "../components/Logo";
import { ProductTour } from "./ProductTour";
import "./landing.css";

/** Public landing page. Everything in the product tour is an illustrative example. */
export function Landing() {
  const me = useMe();
  const meta = useMeta();
  const signedIn = !!me.data;
  const cta = signedIn || DEMO ? "/workspaces" : signInUrl("/workspaces");
  const ctaLabel = signedIn ? "Open dashboard" : DEMO ? "Open the demo" : "Get started with GitHub";

  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-wrap lp-nav-inner">
          <Link to="/" aria-label="PRoof home" className="lp-logo">
            <Logo size={24} />
          </Link>
          <nav className="lp-links" aria-label="Page">
            <a href="#how">How it works</a>
            <a href="#checks">What it checks</a>
            <a href="#trust">Open source</a>
          </nav>
          <div className="lp-nav-actions">
            {!signedIn && !DEMO && (
              <a className="lp-signin" href={signInUrl("/workspaces")}>
                Sign in
              </a>
            )}
            <ButtonLink to={cta} variant="primary" size="sm">
              {signedIn ? "Open dashboard" : "Get started"}
            </ButtonLink>
          </div>
        </div>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-wrap">
            <div className="lp-hero-text">
              <p className="lp-kicker">
                <span className="lp-dot" /> For open-source maintainers
              </p>
              <h1 className="lp-title">Know which pull requests are ready before you open them.</h1>
              <div className="lp-hero-row">
                <p className="lp-lede">
                  PRoof reads every PR the moment it lands: a plain summary, a readiness score, and the exact line behind each flag. You stay the one who decides.
                </p>
                <div className="lp-cta">
                  <ButtonLink to={cta} variant="primary" trailing={<ArrowRight />}>
                    {ctaLabel}
                  </ButtonLink>
                  {meta.data?.repoUrl && (
                    <ButtonLink to={meta.data.repoUrl} variant="secondary" icon={<BookOpen />}>
                      Read the source
                    </ButtonLink>
                  )}
                </div>
              </div>
            </div>
            <ProductTour />
          </div>
        </section>

        <section className="lp-statement">
          <div className="lp-wrap">
            <p className="lp-statement-text">
              Review time goes to the wrong PRs. <span>Code the author can't explain, changes with no issue behind them, and claims that sit silent for weeks. PRoof sorts that out before you open the tab, and shows its working.</span>
            </p>
            <div className="lp-three">
              <Problem title="Code the author can't explain" text="Generated changes that call functions nowhere in your repo, opened by someone who can't say why." />
              <Problem title="PRs with no issue behind them" text="Drive-by changes nobody asked for, with an empty template and no linked issue." />
              <Problem title="Claims that go quiet" text={'"Can I take this?" followed by three weeks of silence while others wait.'} />
            </div>
          </div>
        </section>

        <section className="lp-section" id="how">
          <div className="lp-wrap">
            <SectionHead eyebrow="How it works" title="Three steps, and you control each one." />
            <ol className="lp-steps lp-timeline">
              <Step n={1} icon={<GitPullRequest />} title="Install on GitHub">
                Only an org owner can install PRoof, through GitHub's own install page. Pick the repositories; one workspace per organization.
              </Step>
              <Step n={2} icon={<EyeOff />} title="Watch in shadow mode">
                Every check runs on every PR, but only maintainers see the results, in the dashboard and your team channel. Mark flags as correct or false to measure accuracy.
              </Step>
              <Step n={3} icon={<Radio />} title="Go live, one check at a time">
                When a check earns your trust, turn it live. Contributors then see it on their PR, with a link to how to fix it.
              </Step>
            </ol>
          </div>
        </section>

        <section className="lp-section lp-alt" id="checks">
          <div className="lp-wrap">
            <SectionHead eyebrow="What it checks" title="A score for the PR. Evidence about the person, never a score." />
            <div className="lp-checks">
              <div className="lp-panel">
                <div className="lp-panel-title">Readiness score · public when live</div>
                {[
                  ["Linked issue", "Links an issue that's assigned to or claimed by the author", 15],
                  ["PR template", "Every section of the template has real content", 10],
                  ["CI", "Required checks pass; waiting on approval isn't failing", 15],
                  ["Tests", "Code comes with tests, and none are removed", 15],
                  ["Ghost code", "Every called function and import exists in the repo", 20],
                  ["Size", "Small enough to review carefully", 10],
                  ["Questions", "Short questions on changed lines, answered in the thread", 15],
                ].map(([t, d, p]) => (
                  <div className="lp-check" key={t as string}>
                    <div>
                      <div className="lp-check-title">{t}</div>
                      <div className="lp-check-desc">{d}</div>
                    </div>
                    <span className="lp-pts">{p} pts</span>
                  </div>
                ))}
              </div>
              <div className="lp-stack">
                <div className="lp-panel lp-panel-private">
                  <div className="lp-panel-title">
                    <EyeOff size={13} /> About the contributor · maintainers only
                  </div>
                  <div className="lp-check">
                    <div>
                      <div className="lp-check-title">Spray pattern</div>
                      <div className="lp-check-desc">Many PRs to unrelated repos in a short window, listed repo by repo.</div>
                    </div>
                  </div>
                  <div className="lp-check">
                    <div>
                      <div className="lp-check-title">History</div>
                      <div className="lp-check-desc">New here or a regular. Used to pick a friendlier tone, never to penalise.</div>
                    </div>
                  </div>
                </div>
                <div className="lp-panel">
                  <div className="lp-panel-title">Your own rules</div>
                  <p className="lp-check-desc" style={{ padding: "0 16px 16px" }}>
                    Title formats, required labels, protected paths, paths that need tests. Set them in the dashboard, or call your own service as an external check.
                  </p>
                </div>
                <p className="lp-note">
                  Deliberately left out: "AI-written" detectors and account age. They punish honest newcomers. Ghost code and questions show the real problem with evidence instead.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="lp-section">
          <div className="lp-wrap">
            <SectionHead eyebrow="Delivery" title="The PR gets the public part. Your team gets the whole report." />
            <div className="lp-channels">
              <Channel icon={<GitPullRequest />} name="PR comment" note="One comment, edited in place" />
              <Channel icon={<Hash />} name="Slack" note="Channel message with links" />
              <Channel icon={<MessageCircle />} name="Discord" note="Channel webhook embed" />
              <Channel icon={<Mail />} name="Email" note="One email per PR" />
              <Channel icon={<Webhook />} name="Webhook" note="Signed JSON to your service" />
            </div>
            <div className="lp-three lp-features">
              <Feature icon={<MessageCircleQuestionMark />} title="Questions in the thread">
                PRoof asks the author about specific changed lines. Answers stay on the PR, and the AI can check them against the code.
              </Feature>
              <Feature icon={<ScrollText />} title="Claims that expire">
                <code>/claim</code> and <code>/unclaim</code> on issues, a reminder when a claim goes quiet, and release after a set time.
              </Feature>
              <Feature icon={<Bot />} title="Your model, your key">
                Anthropic, OpenAI or a self-hosted model, with a monthly token cap. Every check still works with AI turned off.
              </Feature>
            </div>
          </div>
        </section>

        <section className="lp-section lp-alt" id="trust">
          <div className="lp-wrap lp-trust">
            <div>
              <SectionHead eyebrow="Open source" title="Read exactly how a PR is judged." />
              <p className="lp-body">
                The scoring, every check and the exact prompts sent to the model live in one package with no network or database access. If PRoof flags something, you can trace why to a line of code.
              </p>
            </div>
            <ul className="lp-trust-list">
              <li>
                <ShieldCheck /> Never closes, rejects or blocks a PR
              </li>
              <li>
                <Lock /> Keys and tokens encrypted at rest, never shown again
              </li>
              <li>
                <FileSearch /> The model never sees contributor history
              </li>
              <li>
                <ScrollText /> Every settings change in an audit log
              </li>
              <li>
                <GitPullRequest /> Roles always come from GitHub, not from PRoof
              </li>
            </ul>
          </div>
        </section>

        <section className="lp-final">
          <div className="lp-wrap lp-final-inner">
            <h2 className="lp-final-title">Spend your review time on the PRs that are ready.</h2>
            <ButtonLink to={cta} variant="primary" trailing={<ArrowRight />}>
              {ctaLabel}
            </ButtonLink>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-inner">
          <Logo size={18} />
          <span className="lp-foot-links">
            {meta.data?.repoUrl && (
              <a href={meta.data.repoUrl} target="_blank" rel="noreferrer">
                Source
              </a>
            )}
            {meta.data?.repoUrl && (
              <a href={`${meta.data.repoUrl}/discussions`} target="_blank" rel="noreferrer">
                Discussions
              </a>
            )}
            {meta.data?.contactEmail && <span className="lp-mail">{meta.data.contactEmail}</span>}
          </span>
        </div>
      </footer>
    </div>
  );
}

function SectionHead({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="lp-head">
      <p className="lp-eyebrow">{eyebrow}</p>
      <h2 className="lp-h2">{title}</h2>
    </div>
  );
}

function Problem({ title, text }: { title: string; text: string }) {
  return (
    <div className="lp-problem-item">
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function Step({ n, icon, title, children }: { n: number; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <li className="lp-step">
      <div className="lp-step-top">
        <span className="lp-step-n">{n}</span>
        <span className="lp-step-icon">{icon}</span>
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
    </li>
  );
}

function Channel({ icon, name, note }: { icon: React.ReactNode; name: string; note: string }) {
  return (
    <div className="lp-channel">
      <span className="lp-channel-icon">{icon}</span>
      <span className="lp-channel-name">{name}</span>
      <span className="lp-channel-note">{note}</span>
    </div>
  );
}

function Feature({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="lp-feature">
      <span className="lp-feature-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
