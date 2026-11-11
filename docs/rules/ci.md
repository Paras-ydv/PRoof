# CI

PRoof checks that the repository's required checks pass on the latest commit of your PR.

## How to fix it

1. Open the failing check from the link in the PRoof comment, or from the Checks tab on your PR.
2. Read the first error in the log. Run the same command locally if you can (often `npm test`, `pytest` or `go test ./...`).
3. Push a fix. PRoof updates its comment when CI finishes.

If your PR comes from a fork, CI may wait for a maintainer to approve the run. That shows as pending, not failing.
