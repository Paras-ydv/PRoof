import { CircleDashed, EyeOff, GitPullRequest, Hash, MessageCircleQuestionMark, Radio } from "lucide-react";
import { CodeRef, ScoreDial } from "../components/Score";
import { StatusIcon, StatusPill, VisibilityTag } from "../components/Status";

/**
 * Pieces of the real product, arranged around the hero headline as its background detail.
 * Purely decorative (hidden from screen readers); every name and number is an example.
 */
export function HeroCollage() {
  return (
    <div className="collage" aria-hidden>
      {/* PR card with its score */}
      <div className="frag frag-pr">
        <div className="frag-bar">
          <GitPullRequest size={12} /> lumen-labs/lumen <span className="frag-mono">#1042</span>
        </div>
        <div className="frag-pr-body">
          <ScoreDial value={74} size={40} />
          <div>
            <div className="frag-title">feat(storage): retry uploads with backoff</div>
            <div className="frag-sub">mira-okafor · first contribution here</div>
          </div>
        </div>
      </div>

      {/* A diff with a flagged line */}
      <div className="frag frag-diff">
        <div className="frag-bar frag-mono">src/storage/upload.ts</div>
        <pre className="frag-code">
          <span className="ln">2</span> import {"{"} S3Client {"}"} from "./s3";{"\n"}
          <span className="ln add">3</span>
          <span className="add">+import {"{"} retry {"}"} from "./retry";</span>
          {"\n"}
          <span className="ln add flag">4</span>
          <span className="add flag">+import {"{"} retryWithJitter {"}"} from "./backoff";</span>
          {"\n"}
          <span className="ln">5</span>
          {"\n"}
          <span className="ln add">6</span>
          <span className="add">+export async function upload(file) {"{"}</span>
        </pre>
        <div className="frag-flag">
          <StatusIcon status="fail" size={14} />
          <span>
            <code>retryWithJitter</code> isn't defined in ./backoff
          </span>
        </div>
      </div>

      {/* A check row */}
      <div className="frag frag-check">
        <StatusIcon status="warn" size={16} />
        <div>
          <div className="frag-title">Tests</div>
          <div className="frag-sub">Code changed with no test changes</div>
          <CodeRef path="src/storage/upload.ts" line={31} />
        </div>
        <span className="frag-pts">5/15</span>
      </div>

      {/* Question on a changed line, with the author's answer */}
      <div className="frag frag-question">
        <div className="frag-q">
          <span className="frag-avatar frag-avatar-bot">P</span>
          <div>
            <div className="frag-who">
              PRoof <span>on line 31</span>
            </div>
            <p>What happens when maxAttempts is 0?</p>
          </div>
        </div>
        <div className="frag-q frag-q-reply">
          <span className="frag-avatar">M</span>
          <div>
            <div className="frag-who">mira-okafor</div>
            <p>The first call still runs once; 0 means no retries.</p>
          </div>
        </div>
        <div className="frag-verdict">
          <MessageCircleQuestionMark size={12} /> Answer matches the code
        </div>
      </div>

      {/* What maintainers get in Slack */}
      <div className="frag frag-slack">
        <div className="frag-bar">
          <Hash size={12} /> pr-triage
        </div>
        <div className="frag-slack-body">
          <strong>lumen-labs/lumen #1042 · 74/100</strong>
          <div className="frag-line">
            <StatusIcon status="fail" size={13} /> Ghost code · 1 name
          </div>
          <div className="frag-line">
            <StatusIcon status="warn" size={13} /> Spray: 11 PRs, 9 repos, 2 d
          </div>
          <VisibilityTag visibility="maintainers" />
        </div>
      </div>

      {/* A claim on an issue */}
      <div className="frag frag-claim">
        <span className="frag-avatar">D</span>
        <div>
          <div className="frag-who">dev-sato</div>
          <code className="frag-cmd">/claim</code>
        </div>
        <StatusPill status="pass">Claimed</StatusPill>
      </div>

      {/* Mode switch */}
      <div className="frag frag-mode">
        <span className="frag-seg">
          <CircleDashed size={11} /> Off
        </span>
        <span className="frag-seg is-shadow">
          <EyeOff size={11} /> Shadow
        </span>
        <span className="frag-seg">
          <Radio size={11} /> Live
        </span>
      </div>

      {/* A clean PR */}
      <div className="frag frag-ready">
        <ScoreDial value={96} size={30} label={false} />
        <div>
          <div className="frag-title">fix(parser): empty frontmatter</div>
          <div className="frag-sub">Ready for review</div>
        </div>
      </div>
    </div>
  );
}
