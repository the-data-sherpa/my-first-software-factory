# Issue tracker: GitHub

Engineering issues and specs for this factory live in GitHub Issues:
`the-data-sherpa/my-first-software-factory`.

Use the `gh` CLI. Pass
`--repo the-data-sherpa/my-first-software-factory`
to issue commands so operations cannot accidentally target Vanguard.

## Operations

- Read an issue's full body, labels, and comments; paginate when needed.
- Publish an approved ticket as a GitHub issue.
- Use a body file or heredoc for multiline issue bodies.
- Use the configured triage-label mapping.
- Follow the invoking skill's review and publication requirements.

## Blocking relationships

Use GitHub's native issue dependencies when supported.
The blocked-by endpoint takes the blocker's numeric database ID,
not its issue number or node ID.

If native dependencies are unavailable, list blocking issue references
in the ticket's "Blocked by" section. Report relationship failures;
do not claim an edge exists when it was not created.

## Pull requests as a triage surface

**PRs as a request surface: no.**
