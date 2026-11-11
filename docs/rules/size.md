# Size

PRoof checks that your PR is a size that can be reviewed carefully. Lockfiles and generated files don't count.

## How to fix it

Split the change into smaller PRs that each do one thing, for example a refactor first and the feature second. Each part is easier to review, and quicker to merge.

Some changes are large by nature. Maintainers can add the `proof:large-ok` label to skip this check.
