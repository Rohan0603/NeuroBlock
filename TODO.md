# VoxelCortex Task and Goal Ledger

This is the durable task queue for autonomous agent development. Agents must
read it before starting work and update it after each completed or blocked
task.

## Status vocabulary

- `BACKLOG` — identified, not started.
- `READY` — prerequisites are complete.
- `IN_PROGRESS` — actively being implemented.
- `BLOCKED` — cannot proceed; explain the blocker.
- `VERIFY` — implementation exists and needs validation.
- `DONE` — verified complete.
- `CANCELLED` — intentionally removed from scope.

## Priority vocabulary

- `P0` — correctness, safety, security, or broken startup.
- `P1` — required runtime capability.
- `P2` — important quality or operability improvement.
- `P3` — optional polish or future enhancement.

## Active tasks

| ID | Status | Priority | Task / goal | Owner | Dependencies | Acceptance |
|---|---|---|---|---|---|---|
| VC-001 | DONE | P0 | Establish System 0 safety and execution boundary | Agent | — | Typecheck, tests, and kernel ownership preserved |
| VC-002 | DONE | P1 | Integrate Jev System 1 | Agent | VC-001 | Live Jev diagnostic passes |
| VC-003 | DONE | P1 | Integrate OpenCode Zen System 2 | Agent | VC-001 | Live OpenCode diagnostic passes |
| VC-004 | DONE | P1 | Start compatible local Paper and viewer | Agent | VC-001 | Bot spawn and viewer HTTP 200 |
| VC-005 | DONE | P1 | Route human goals through System 2 to System 1 | Agent | VC-002, VC-003 | Goal API and active runtime status work |
| VC-006 | DONE | P1 | Add validated craft capability | Agent | VC-001, VC-002 | `craft` intent validates and reaches kernel |
| VC-007 | DONE | P1 | Replace pathfinder scaffold with bounded A* | Agent | VC-004 | Worker performs bounded A* over transferred primitive grid |
| VC-008 | DONE | P1 | Connect worker navigation results to runtime | Agent | VC-007 | Runtime refreshes path and exposes path length in status |
| VC-009 | DONE | P2 | Add runtime pause/resume and emergency stop API | Agent | VC-005 | Control API and CLI idle controls and report lifecycle |
| VC-010 | DONE | P2 | Add persistent structured telemetry export | Agent | VC-005 | JSONL runtime events and `/telemetry` endpoint |
| VC-011 | DONE | P2 | Add integration tests with fake Mineflayer bot | Agent | VC-005 | Complete goal-to-action flow test passes with fake providers and bot |
| VC-012 | DONE | P2 | Perform 20Hz allocation and latency audit | Agent | VC-008 | 1000 samples; p95 0.002ms under 50ms budget |
| VC-013 | BLOCKED | P2 | Add authenticated remote control design | Agent | VC-009 | Requires explicit owner approval before exposing control beyond loopback |
| VC-014 | DONE | P3 | Improve recipe planning and crafting goals | Agent | VC-006 | Bounded recursive prerequisite recipes |
| VC-015 | DONE | P0 | Decide fate of unwired scaffolds | Agent | VC-005 | Deleted unwired generic LLM client, config, perf, telemetry, and worker scaffolds; removed exports and stale GridSnapshot type |
| VC-016 | DONE | P1 | Add bounded block placement and build plans | Agent | VC-005, VC-008 | Validated place intents execute through System 0 |

## Current human goals

Human goals are runtime data and should normally be set through the control
API, not permanently written here:

```text
No persistent human goal recorded.
```

Use:

```powershell
npm run goal -- set "..."
```

## How to add a task

Add a row with:

- Unique ID such as `VC-015`.
- Initial status `BACKLOG`.
- Priority.
- Observable acceptance criteria.
- Dependencies.
- Any safety or architecture impact.

Do not add vague tasks such as “improve AI”. Split them into a bounded,
testable outcome.

## Completion record

Latest verified batch:

- VC-007/008: `npm run typecheck`, `npm run build`, and `npm test` pass.
- VC-009: lifecycle API and CLI coverage pass in `test/contracts.test.ts`.
- VC-011: complete goal-to-action integration test passes with fake System 2,
  System 1, and Mineflayer components.
- VC-013 remains blocked because remote authenticated control lacks explicit
  owner approval.
- VC-010: JSONL telemetry and `/telemetry` endpoint added.
- VC-012: `npm run audit:20hz` passed with p95 0.002ms / 50ms budget.
- VC-014: bounded recursive prerequisite recipe planning added.
- VC-016: validated placement intent and System 0 placement added.

When moving a task to `DONE`, record:

- Files changed.
- Validation commands and results.
- Any known limitation.
- Follow-up task IDs, if needed.

## Blocker record

When moving a task to `BLOCKED`, record:

- Exact error or missing decision.
- What was attempted.
- Smallest decision or resource needed to continue.
