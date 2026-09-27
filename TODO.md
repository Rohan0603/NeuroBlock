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
| VC-013 | BLOCKED | P2 | Add authenticated remote control design | Agent | VC-009 | Deferred by owner; control remains loopback-only |
| VC-014 | DONE | P3 | Improve recipe planning and crafting goals | Agent | VC-006 | Bounded recursive prerequisite recipes |
| VC-015 | DONE | P0 | Decide fate of unwired scaffolds | Agent | VC-005 | Deleted unwired generic LLM client, config, perf, telemetry, and worker scaffolds; removed exports and stale GridSnapshot type |
| VC-016 | DONE | P1 | Add bounded block placement and build plans | Agent | VC-005, VC-008 | Validated place intents execute through System 0 |
| VC-017 | BLOCKED | P0 | Recover terrain-aware navigation and runtime health monitoring | Agent | VC-008 | Walkable routes reject vertical-only targets; stalls are bounded, observable, and safely paused; Mineflayer lifecycle faults are visible |
| VC-018 | DONE | P2 | Prefer native Mineflayer lookAt for movement targeting | Agent | VC-017 | System 0 uses async-safe `bot.lookAt` with target-cell center and preserves 20Hz synchrony |
| VC-019 | DONE | P0 | Cancel in-flight digging on the idle safety fail-safe | Agent | VC-001 | `bot.stopDigging()` fires when the kernel transitions to idle while a dig is pending, matching the existing `clearControlStates()` reset |
| VC-020 | DONE | P1 | Fix silent no-op attack intents with native target selection | Agent | VC-005 | `attack` intents without a target use `bot.nearestEntity` (mob/hostile, in reach, excludes players and Armor Stand) instead of never executing |
| VC-021 | DONE | P1 | Add context-sensitive capability registry for System 1 | Agent | VC-020 | Single capability source drives firewall, Jev criteria, System 2 data-only hints, narrowed Jev action menus, and table-driven System 0 dispatch |
| VC-022 | DONE | P1 | Extend capability registry with flee, drop, equip, sleep, activate | Agent | VC-021 | Five new native-Mineflayer-backed actions registered, dispatched, and target-filled through the existing capability/firewall/kernel pipeline with no new attack surface |
| VC-023 | DONE | P0 | Replace custom worker A* with mineflayer-pathfinder | Agent | VC-022 | Official pathfinder plugin, Movements, GoalNear navigation events, bounded lifecycle reset, and worker navigation deletion |
| VC-024 | DONE | P1 | Use typed Jev commands and collectblock resource goals | Agent | VC-023 | Intent targets use validated discriminated objects; System 1 can select collect; System 0 delegates collection to mineflayer-collectblock |
| VC-025 | BLOCKED | P0 | Validate live Pathfinder startup and tower placement safety | Agent | VC-024 | Startup and HTTP checks pass; tower goal remains blocked by repeated Pathfinder `stuck` events and no completed placement |
| VC-026 | BLOCKED | P0 | Build tower targets from verified supports | Agent | VC-025 | Single-flight and support lookup implemented; live server still rejects placement at selected target |
| VC-027 | VERIFY | P0 | Recover bots embedded in terrain | Agent | VC-025 | Physics-tick detection checks feet/head occupancy, System 0 issues bounded jump pulses, and runtime replans to the nearest two-block-clear stand; live Paper confirmation remains |
| VC-028 | DONE | P0 | Give System 1 world context on navigation stalls | Agent | VC-027 | Stuck navigation now triggers a bounded asynchronous System 1 decision with bot state, navigation fault, nearby solid block coordinates, entities, inventory, and full recovery action set |
| VC-029 | VERIFY | P0 | Stabilize native survival movement | Agent | VC-028 | Pathfinder uses native one-block jumps, planner-controlled motion, vine climbing, no parkour sprinting, no pillaring, two-block drops, and bounded native search; live movement confirmation remains |
| VC-030 | DONE | P1 | Emit typed System 2 objectives | Agent | VC-024 | StrategicLoop maps provider directives to typed explore, collect, build, farm, survive, combat, or shelter objectives; System 1 receives objective in primitive state |
| VC-031 | VERIFY | P0 | Prevent overlapping native movement goals | Agent | VC-029 | System 0 ignores replacement `GoalNear` requests while Pathfinder is moving; live bounded-memory movement confirmation remains |
| VC-032 | DONE | P1 | Keep startup safe without human goal | Agent | VC-031 | Runtime no longer starts exploratory Pathfinder searches before human goal input; default movement intent becomes idle |
| VC-033 | DONE | P0 | Load navigation dependencies once | Agent | VC-032 | Runtime loads Pathfinder before collectblock; live startup returned HTTP 200 with stable process memory and collectblock reused the existing plugin |
| VC-034 | VERIFY | P0 | Add pit escape decision context | Agent | VC-033 | Adds validated `jump` capability, bounded System 0 jump pulse, and 5x5x6 primitive terrain window for System 1; live pit goal still triggers repeated noPath work before visual escape confirmation |

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

- VC-023/024/028/030/032/033: native Pathfinder and collectblock integration,
  typed actions and objectives, primitive recovery context, safe startup, and
  single-plugin loading pass typecheck, tests, and build.
- Authentication remains deferred by owner; control API stays loopback-only.
- VC-007/008: `npm run typecheck`, `npm run build`, and `npm test` pass.
- VC-009: lifecycle API and CLI coverage pass in `test/contracts.test.ts`.
- VC-011: complete goal-to-action integration test passes with fake System 2,
  System 1, and Mineflayer components.
- VC-013 remains deferred; control stays loopback-only.
- VC-010: JSONL telemetry and `/telemetry` endpoint added.
- VC-012: `npm run audit:20hz` passed with p95 0.002ms / 50ms budget.
- VC-014: bounded recursive prerequisite recipe planning added.
- VC-016: validated placement intent and System 0 placement added.
- VC-018: movement targeting uses native async-safe `bot.lookAt`; focused
  debounce and target-center test passes.
- VC-019: idle fail-safe now calls `bot.stopDigging()` when a dig is pending,
  closing a gap where an in-flight `bot.dig()` kept running through an
  unsafe/idle transition; matching `stopDigging` cancellation test passes.
- VC-020: `attack` intents without a target previously never reached
  `ExecutionKernel.attack()` (fell through `completeIntent` unchanged); now
  falls back to `bot.nearestEntity` filtered to mob/hostile entities within
  4 blocks, excluding players and Armor Stand, matching the official
  `attack.js`/`guard.js`/`looker.js` examples. Test passes.
- VC-021: capability registry now drives validated actions and Jev criteria;
  System 2 emits data-only relevant capability names; Jev receives a
  context-sensitive menu; System 0 remains the only Mineflayer executor.
  Typecheck, 15 tests, and build pass.
- VC-022: extended the registry with 5 pilot-phase actions, each backed by a
  real Mineflayer API and target-filled the same way existing actions are
  (`agent_runtime.ts` `completeIntent`, no changes needed to `firewall.ts`
  or `jev_client.ts` since both already derive from the registry):
  - `flee` reuses `move()`'s existing look/forward machinery with sprint
    enabled, targeting a point away from the nearest hostile
    (`bot.nearestEntity`), avoiding a second stuck-control-state code path.
  - `drop` uses `bot.tossStack` on a junk inventory item.
  - `equip` uses `bot.equip` to wear an armor piece in its matching slot.
  - `sleep` uses `bot.isABed`/`bot.findBlock` and `bot.sleep`, gated by
    `bot.time.isDay` and `bot.isSleeping`; the idle fail-safe now also calls
    `bot.wake()` if the bot is asleep, alongside the existing
    `stopDigging()` reset.
  - `activate` uses `bot.findBlock` + `bot.activateBlock` for nearby doors,
    chests, levers, and similar interactables.
  Typecheck, 24 tests, and build pass.
- VC-017: terrain-aware planner, waypoint progress monitoring, lifecycle safety,
  and telemetry integrity checks implemented. Typecheck, tests, and build pass.
  Live verification blocks safely: loaded 16³ grid has 2,764 solid cells and
  no walkable route from the bot position; runtime pauses with `Navigation:
  no-route` rather than looping.

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

### VC-017

- **Exact blocker:** local Paper world has no walkable route from the current
  bot position after Mineflayer confirms chunks loaded.
- **Attempted:** bounded terrain route, nearby-start recovery, and closest
  reachable obstacle recovery. Live telemetry reported 2,764 solid cells in
  the 16³ local grid, then `navigation.unavailable: no-route`.
- **Needed:** place the bot in a traversable local area or approve a separate,
  goal-mediated escape/mining capability with its own safety acceptance.
