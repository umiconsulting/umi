# Work records and retired trackers

Updated: 2026-11-08, after Juan's direct correction.

## Current status

Umi no longer uses Azure Boards.
Trello and Plane also remain retired as trackers.
No replacement external tracker is confirmed here.

The previous version named Azure Boards as the current source of requirements.
That guidance is obsolete. It must not trigger a connection request, a tracker write, or a pause in local work.

## Current work

Read the user's current instruction and the active task brief first.
Use the local record named by that run for its scope, dependencies, and pending work.
Link evidence instead of copying conflicting status into several documents.

A pending item records:

- A stable identifier and the expected result.
- Its owner and priority.
- Its dependencies and next action.
- Its state and last verification date.
- Its acceptance criteria and evidence links.
- Any publication restriction or decision reserved for Juan.

Separate implementation, verification, publication, and deployment states.
A local test result does not prove a deployment.
An agent's summary does not prove that an acceptance criterion passed.
Mark unknown status as unverified until a source establishes it.

## Code review and publication

GitHub PRs remain the code review surface when the user authorizes publication.
A local brief can supply the specification for a code review.
An external work item is not a prerequisite for local implementation or verification.

Follow the current publication restriction for each run.
Do not infer permission to push, open a PR, merge, or deploy from this document.

## Historical references

Old commits and documents can contain Azure URLs and `AB#` identifiers.
Those references identify historical records. They do not identify the current tracker or prove current task status.
Keep historical evidence intact. Do not recreate or update retired tracker items without a new explicit request.

Old skill copies can still describe Azure-specific workflows.
Their tracker assumptions are superseded by this document and Juan's current instruction.
Use their relevant review method with the current local brief where possible.
Do not configure another external system as a side effect.
