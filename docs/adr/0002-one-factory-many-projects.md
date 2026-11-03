---
status: accepted
accepted: 2026-11-02
---

# One factory manages multiple projects

The factory's job is repository maintenance, not ownership of exactly one repository.
The owner chose one factory managing multiple projects rather than a separate factory per project, to match the intended shared management experience.
Phase 1 supports only Vanguard and one active run total; multi-project management and concurrency belong in a later phase, currently planned for Phase 4.
Do not turn the initial single-project scope into a permanent one-project-per-factory restriction or build multi-project execution in Phase 1.

[The Phase 1 interview](../phase-1-plan.md) will settle project-scoped work, artifact ownership, and execution boundaries separately.
The canonical meanings of Factory, Job, and Project are in [CONTEXT.md](../../CONTEXT.md).
This decision records the ownership model, not authorization to implement Phase 1 or the later multi-project phase.
