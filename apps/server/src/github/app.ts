import { App, Octokit } from "octokit";
import type { Env } from "../env.js";

export type { Octokit };

/** The PRoof GitHub App. Installation clients act on repos; user clients act as a signed-in maintainer. */
export function createGithubApp(env: Env): App {
  return new App({
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_PRIVATE_KEY,
    webhooks: { secret: env.GITHUB_WEBHOOK_SECRET || "unset" },
    oauth: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET },
  });
}

/** A client acting as a signed-in user, using their GitHub user access token. */
export function userClient(token: string): Octokit {
  return new Octokit({ auth: token });
}
