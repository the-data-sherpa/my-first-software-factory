# Tiny Software Factory

A small, single-purpose system where a persistent agent prepares work for one recurring job and brings consequential decisions back to a person.

## Language

**Factory**:
A system built around one recurring job, with its own agent, tools, workspace, and approval rules. One factory can manage several projects; a project is not a separate factory.
_Avoid_: Assistant, bot, pipeline

**Job**:
The recurring problem a factory exists to serve, such as repository maintenance across its projects.
_Avoid_: Purpose, task, use case

**Project**:
A repository the factory maintains, with its own identity and context. One factory can manage multiple projects.
_Avoid_: Factory, workspace, worktree

**Task brief**:
A description of a maintenance task's goal, acceptance criteria, and evidence. Defines the desired result without prescribing the execution method.
_Avoid_: Workflow, work item, transcript

**Trigger**:
The thing that starts a run: a person, a schedule, or an event.
_Avoid_: Kickoff, cron

**Run**:
One execution of the factory's agent for one project, started by a trigger.
_Avoid_: Job, execution, session

**Work item**:
A unit of output for one project that waits for a person's review, such as one candidate task with its evidence. A run produces zero or more work items; a work item may gather further runs for that project. Readiness for review does not grant Approval for a Proposal.
_Avoid_: Ticket, task, result

**Proposal**:
The consequential action attached to a work item, which a person approves or rejects.
_Avoid_: Suggestion, plan, action

**Approval**:
A person's recorded decision to allow a proposal to be carried out. Approval applies to a proposal, never to a whole run.
_Avoid_: Sign-off, confirmation

**Meta-thread**:
The owner-facing conversation for coordinating requirements, priorities, dependencies, and lead assignments.
_Avoid_: Run, work item

**Lead**:
The agent accountable for one bounded maintenance outcome through the factory's workflow.
_Avoid_: Meta-thread, work item
