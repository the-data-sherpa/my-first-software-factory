# Domain docs

This repository uses one context.

- Canonical glossary: `CONTEXT.md`
- Architectural decisions: `docs/adr/`

## Before exploring or changing code

Read the glossary and ADRs relevant to the work.
For Phase 1 work, also read the accepted design in
`docs/phase-1-plan.md`.

Design acceptance does not itself authorize implementation or live inference.

If glossary or ADR files are missing, proceed silently.
Use domain-modeling to capture terms and decisions when they are resolved.

## Vocabulary

Use the glossary's canonical terms in issue titles, hypotheses,
test names, and design proposals.

Keep `CONTEXT.md` limited to domain definitions.
Record architectural trade-offs in ADRs.

## Conflicts

Surface conflicts with an existing ADR before changing the design.
Do not silently override an accepted decision.

## Compatibility

`GLOSSARY.md` points to `CONTEXT.md`.
Maintain definitions in `CONTEXT.md`, not in both files.
