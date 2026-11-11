# Linked issue

PRoof checks that your pull request is linked to an issue, and that the issue is assigned to you or claimed by you.

## Why it matters

Maintainers plan work through issues. A linked issue tells them what problem your PR solves and that nobody else is working on it.

## How to fix it

1. Find the issue your change solves. If there isn't one, open it first and describe the problem.
2. Add a line like `Fixes #123` to your PR description. GitHub links the issue automatically.
3. Ask on the issue to be assigned, or comment `/claim` if the repository uses claims.

Small changes (typo fixes and the like) don't need an issue. Maintainers can also add the `proof:no-issue-ok` label to skip this check.
