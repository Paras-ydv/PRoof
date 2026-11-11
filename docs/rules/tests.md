# Tests

PRoof checks that code changes come with test changes, and that no tests or assertions were removed.

## How to fix it

- **Code changed without tests:** add or update a test that would fail without your change. Look for an existing test file next to the code you changed and follow its style.
- **Tests were removed:** if removing them was intentional (the feature is gone), say so in the PR description so maintainers know. Otherwise restore them.

Docs-only and config-only changes don't need tests and aren't scored here.
