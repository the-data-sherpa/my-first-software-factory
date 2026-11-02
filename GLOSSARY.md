# Tiny Software Factory

A small, single-purpose system where a persistent agent prepares work for one recurring job and brings consequential decisions back to a person.

## Language

**Factory**:
A system built around one recurring job, with its own agent, tools, workspace, and approval rules.
_Avoid_: Assistant, bot, pipeline

**Job**:
The recurring problem a factory exists to serve, such as maintaining one repository.
_Avoid_: Purpose, task, use case

**Trigger**:
The thing that starts a run: a person, a schedule, or an event.
_Avoid_: Kickoff, cron

**Run**:
One execution of the factory's agent, started by a trigger.
_Avoid_: Job, execution, session

**Work item**:
A unit of output that waits for a person's review, such as one candidate task with its evidence. A run produces zero or more work items; a work item may gather further runs.
_Avoid_: Ticket, task, result

**Proposal**:
The consequential action attached to a work item, which a person approves or rejects.
_Avoid_: Suggestion, plan, action

**Approval**:
A person's recorded decision to allow a proposal to be carried out. Approval applies to a proposal, never to a whole run.
_Avoid_: Sign-off, confirmation
