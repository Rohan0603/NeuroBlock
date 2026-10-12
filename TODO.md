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
| VC-002 | DONE | P1 | Integrate Jev System 1 | Agent | VC-001 | *Jev has been removed from the deterministic decision path; all actions now resolve through the survival policy move fallback. See refactor decision in PROJECT_MASTER.md and AGENTS.md.*
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
| VC-035 | DONE | P0 | Allow native nearby-block mining for pit escape | Agent | VC-034 | System 1 `mine` intents resolve a nearby solid block with `bot.findBlock`; System 0 validates and digs exact block through native Mineflayer APIs |
| VC-036 | DONE | P2 | Record Mindcraft LLM and Mineflayer reference | Agent | VC-023, VC-030 | `reference.md` documents external architecture, provider flow, Mineflayer usage, safety limits, and VoxelCortex mapping |
| VC-037 | VERIFY | P1 | Add bounded native action results and recovery feedback | Agent | VC-035 | Dig and collect report primitive results; latest result reaches System 1; repeated target failures pause safely |
| VC-038 | VERIFY | P1 | Add optional native tool selection before mining | Agent | VC-037 | Kernel uses optional `bot.tool.equipForBlock` before validated dig; default runtime remains dependency-free |
| VC-039 | VERIFY | P2 | Add capability metadata and survival progress state | Agent | VC-037 | Capability prompts include preconditions/failures/recovery; farm checkpoints and bounded named locations appear in state/status |
| VC-040 | VERIFY | P0 | Prioritize mine escape before farm construction | Agent | VC-039 | Explicit escape goals perform bounded mining and movement before crafting or placement; live goal confirms open-ground progress |
| VC-041 | VERIFY | P0 | Keep provider timeout from killing runtime | Agent | VC-040 | Strategic loop reports provider errors and keeps control/status endpoints alive |
| VC-042 | VERIFY | P1 | Sequence escape before farm work | Agent | VC-041 | System 2 emits ordered farm steps; System 1 uses native block observations and Pathfinder status to select escape actions |
| VC-043 | VERIFY | P1 | Make System 1 choose survival phase actions | Agent | VC-042 | Pure System 1 policy selects escape, gathering, and tool-preparation actions from System 2 steps and primitive observations before Jev fallback |
| VC-044 | VERIFY | P0 | Apply bounded forward-jump mine rescue | Agent | VC-043 | System 0 uses bounded forward+jump pulses and clears controls; live mine escape confirms physical progress |
| VC-045 | VERIFY | P0 | Complete deterministic System 1 targets | Agent | VC-044 | Policy-selected mine and jump actions pass through runtime target completion before System 0; live escape confirms position change |
| VC-046 | VERIFY | P0 | Clear bounded tunnel toward open space | Agent | VC-045 | System 1 permits bounded noPath excavation; runtime chooses cardinal clearance with native blockAt and retries Pathfinder |
| VC-047 | VERIFY | P1 | Add relative navigation observation context | Agent | VC-046 | System 1 receives destination delta, distance, direction, and relative terrain coordinates while System 0 retains absolute targets |
| VC-048 | VERIFY | P0 | Detect safe open ground before ending escape | Agent | VC-047 | System 1 receives native-derived safe-open-ground state; escape stops excavation only with solid support and eight-block headroom |
| VC-049 | VERIFY | P1 | Preserve survival actions in narrowed capability menu | Agent | VC-048 | Farm/escape directives retain move, jump, mine, collect, and craft for System 1 policy |
| VC-050 | VERIFY | P1 | Add bounded Jev direction hints | Agent | VC-049 | Jev selects cardinal direction hints; runtime resolves relative hints and System 0 retains absolute target validation |

| VC-051 | VERIFY | P0 | Dig validated obstructions during embedded recovery | VC-027, VC-035 | Embedded monitor selects a native-diggable feet/head/side block through System 0 before bounded jump rescue; tests and live confirmation pass |
| VC-052 | DONE | P0 | Prevent farm-goal runtime out-of-memory failure | VC-051 | Runtime decision cycles are single-flight; viewer and control API stay responsive after farm goal |
| VC-053 | VERIFY | P0 | Escape underground before farm work | VC-040, VC-052 | Build/farm goals select bounded escape excavation until native safe-open-ground state is true, then gather and farm |
| VC-054 | VERIFY | P1 | Add named world identity | VC-030 | Status and provider observations expose configured server/gametype/map; optional `/locraw` updates identity on compatible servers |
| VC-055 | VERIFY | P1 | Enable Pathfinder route digging | VC-023, VC-053 | Pathfinder can dig obstructing route blocks and jump toward goals; direct mining safety remains in System 0 |
| VC-056 | VERIFY | P0 | Resolve Jev movement toward surface | VC-055 | Runtime converts Jev movement into the highest nearby safe-open-ground target, or an eight-block upward target when surface blocks are not loaded |
| VC-057 | VERIFY | P1 | Narrow Jev to ambiguous decisions | VC-030, VC-056 | Deterministic System 1 actions skip Jev; fallback Jev uses confidence gating, pinned model configuration, and measurable outcome counters |
| VC-058 | BLOCKED | P0 | Add bounded task state and observable escape completion | VC-034, VC-057 | Stand-target boundary now rejects loaded non-standable `GoalNear` coordinates and escape digs use adjacent obstructions; live bot moves but still hits Pathfinder `noPath` and `ACTION_TIMEOUT`, so no `task.completed` |
| VC-059 | BLOCKED | P0 | Build and telemetry-verify grounded home goal | Agent | VC-058 | Goal builds 24-block native Mineflayer shelter and emits `home.verified` |

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
- VC-035: native nearby-block mining now gives pit recovery a validated dig
  option; typecheck and 24 tests pass.
- VC-037/038/039: native dig and collect results now expose bounded primitive
  success/failure state, optional tool selection runs before digging, Jev gets
  richer capability criteria, repeated target failures pause after three
  attempts, and farm checkpoints plus bounded named locations reach state and
  status. Full lifecycle timeout coverage and live tool-plugin verification
  remain pending.
- VC-040: explicit mine-escape goals now bypass farm crafting until three
  successful nearby dig results, then request movement toward open terrain.
  Live confirmation remains pending.
- VC-041: StrategicLoop interval now catches provider failures and reports
  them without creating an unhandled rejection that terminates Node.
- VC-042: farm objectives with escape language now carry ordered
  `escape`, `gather`, `farm` steps; escape mining uses native `findBlocks` plus
  `blockAt` positions before movement. Live route confirmation remains pending.
- VC-043: pure System 1 survival policy now selects `mine`, `jump`, `move`,
  `collect`, or `craft` from ordered objective steps and primitive observations;
  Jev remains fallback for uncovered actions.
- VC-044: bounded jump and embedded rescue pulses now include forward movement
  before clearing controls, based on MineflayerTutorials jumper behavior.
  Live mine escape confirmation remains pending.
- VC-045: policy-selected actions now pass through the same target completion
  path as provider actions. Previously `mine` had no target, so System 0
  silently ignored it every 50 ms.
- Live VC-045 verification reached System 0 with an exact block target, dug
  successfully, and moved the bot from `(-4,64,-2)` to `(-3,64,-3)`.
  Native `bot.dig(block, true)` and `bot.canDigBlock` removed the no-target and
  aim-timeout failures. Remaining `noPath` reflects local mine geometry.
- VC-046: noPath recovery now chooses best cardinal two-block clearance and
  allows up to 12 bounded digs before jump fallback. Live verification reached
  Pathfinder `success`/`moving` after directional excavation; farm completion
  still requires verification.
- VC-047: observations now include relative `dx/dy/dz` terrain coordinates and
  navigation delta, distance, vertical distance, and cardinal direction.
- VC-048: runtime now reports `world.safeOpenGround` from native block queries;
  System 1 stops escape mining there and can begin gather/craft checkpoints.
- VC-049: farm and escape directives now retain navigation, excavation, gather,
  and craft actions; previous narrowing removed `move` and `collect`, causing
  System 1 to fall back to idle after escape.
- Live VC-049 verification exposed prior `idle` fallback, then confirmed fixed
  menu `["mine","eat","place","activate","move","jump","collect","craft","idle"]`
  and System 1 selected `collect` after escape.
- VC-050: Jev now returns validated cardinal direction hints with bounded
  distance; runtime uses hints for escape and movement target resolution.
- VC-051: embedded recovery now selects and digs one validated nearby obstruction
  before forward+jump rescue. Pathfinder remains non-digging by configuration;
  runtime excavation and path retries are separate bounded phases. Live
  confirmation remains pending.
- VC-052: farm-goal OOM investigation found overlapping asynchronous decision
  cycles and an over-broad collectblock target. Runtime now makes decision
  cycles single-flight, limits collectblock to eight blocks, and targets grass
  for farm seed gathering. Live validation stayed responsive for 45 seconds;
  runtime paused safely after no grass/tall grass was found within eight blocks.
- VC-054: world identity now appears in runtime status and provider state.
  Local Paper defaults to configured `local-paper` / `survival` / `world`;
  compatible servers can update identity from `/locraw`.
- VC-053: build and farm goals now require native safe-open-ground state before
  gathering, crafting, or placement. Zero sky light marks underground air as
  unsafe. Live escape confirmation remains pending.
- VC-055: Pathfinder route digging is enabled with `Movements.canDig = true`.
  Parkour, free motion, sprinting, and pillaring remain disabled. Live
  underground escape and farm progression remain pending.
- VC-056: movement target resolution now prefers highest nearby safe ground and
  falls back to eight blocks above the bot. Live surface reach remains pending.
  Live farm-escape run emitted surface targets at `y=64`; Pathfinder reported
  `success` and remained responsive while moving. A buried-mine run is still
  needed to confirm the `y + 8` fallback and final `goal_reached` event.
- VC-057: deterministic policy actions no longer issue discarded Jev requests.
  Fallback Jev decisions below 0.6 confidence return no intent; example
  configuration pins Jev to `jev-1.13.0`; requests fall back after 600 ms.
  Status and telemetry now count usage, timeout, low-confidence, applied, and
  changed Jev outcomes.
- Startup decision timer skips action decisions until a human goal exists,
  preventing autonomous collection/pathfinding before live testing.
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

### VC-058

- **Exact blocker:** live Paper bot spawned at `(-3, 64, -1)` in a state that
  does not satisfy `safeOpenGround`; repeated native mining did not produce a
  completed escape task during smoke validation.
- **Attempted:** submitted `Escape the pit` through the loopback goal API;
  successful digs now emit `navigation.escape-replan` with an absolute
  `GoalNear` target. Candidate IDs are now validated at the firewall and
  revalidated against fresh Mineflayer observations before execution. Task
  deadlines, retry limits, lifecycle failure handling, structured plans, and
  stable completion checks are covered by the contract suite. Pathfinder still
  reported `noPath`, and a later dig aborted, so the task did not complete.
  Viewer/status stayed responsive.
- **Needed:** place the bot in a known pit or traversable test fixture, then
  verify `task.completed` and `status.task.status == "complete"` from live
  Mineflayer observations.
- **Latest live evidence:** bot position moved from `(-2.43, 64, -0.30)` to
  `(-5.01, 64, -2.49)`; support remained stone, overhead clearance remained
  blocked, and recovery ended with `DIG_FAILED: Digging aborted` on a stale
  distant block target. The runtime now exposes position and completion
  predicate diagnostics in `/status`.
- **Next fix:** keep escape recovery on a bounded vertical shaft until
  overhead clearance is resolved; do not let Jev/path candidates redirect
  mining to stale horizontal targets.
- **Latest validation:** vertical-only recovery now prevents stale horizontal
  movement, System 0 stops Pathfinder before digging, and all 30 contract
  tests plus typecheck/build pass. Live bot still fails to clear the shaft:
  `ACTION_TIMEOUT` at `(-3, 67, 1)` with six blocked overhead cells.

- **Latest validation:** vertical-only recovery now prevents stale horizontal
  movement, System 0 stops Pathfinder before digging, and all 31 contract
  tests plus typecheck/build pass. Live bot still fails to clear the shaft:
  `ACTION_TIMEOUT` at `(-3, 67, 1)` with six blocked overhead cells.

### VC-059

- **Exact blocker:** live goal remains `active/gather`; `decisionCount` stays
  `0` after submission, so no System 1 intent reaches native placement.
- **Attempted:** deterministic 24-cell shell, native stone/log gathering,
  native `placeBlock`, status home counts, and `home.progress`/`home.verified`
  telemetry. Live fixture has no reachable building material; collectblock
  caused Node heap exhaustion. Fixed server-chat fixture commands were tested
  but did not alter world state and were removed.
- **Needed:** repair live runtime decision-loop startup or provide a clean
  traversable Paper fixture with reachable stone/log resources.

---

Jev removal refactor (this session):

- **Task:** Remove Jev from the System 1 deterministic decision path
- **Status:** COMPLETED
- **Changes:** Removed Jev invocation, requestJev method, JevClient field, jevMetrics, and JevClient export; updated types, tests, and documentation; move fallback now deterministic
- **Capability lost:** Unrecognized states now always resolve to `move` instead of going through Jev; Jev client and TypeSafe API key no longer required for decision cycle
- **Verification:** `npm test`, `npm run typecheck`, `npm run build` all pass
