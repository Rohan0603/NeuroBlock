# VoxelCortex Architecture

## Purpose

VoxelCortex is a local-first Minecraft agent. Human goals enter a controlled
planning path:

```text
Human goal -> System 2 plan -> task state -> System 1 intent -> execution gate -> Mineflayer plugins
```

Human input never becomes a direct Minecraft action.

## Runtime layers

### System 2: strategy

**Code:** [`src/system2/strategic_loop.ts`](./src/system2/strategic_loop.ts),
[`src/system2/opencode_client.ts`](./src/system2/opencode_client.ts)

- Reads the current human goal and primitive observations.
- Uses OpenCode Zen to produce a bounded JSON task plan, then maps it to a typed `StrategicObjective`.
- Refreshes on startup, goal changes, and its configured slow interval.
- Does not call Mineflayer or mutate world state.

### System 1: action selection

**Code:** [`src/system1/jev_client.ts`](./src/system1/jev_client.ts),
[`src/system1/firewall.ts`](./src/system1/firewall.ts)

- Receives the System 2 directive and current primitive state.
- Selects one allowed action from a context-sensitive menu (full menu when
  the directive gives no clear match).
- Validates action shape with TypeBox/Ajv.
- Produces an `Intent` with a state version.
- Runs asynchronously outside the 20Hz safety path.
- Runs only when deterministic task policy has no answer.

Allowed actions ([`src/core/capabilities.ts`](./src/core/capabilities.ts) is
the single source of truth for this list, the firewall schema, and Jev's
per-action criteria):

```text
move | jump | attack | mine | collect | eat | craft | place | flee | drop | equip | sleep | activate | idle
```

System 2 may attach `relevantCapabilities` (action names only) to its
directive and typed objective metadata; System 2 never calls Mineflayer or
invokes an action.

### System 0: safety and execution

**Code:** [`src/system0/brainstem_tick.ts`](./src/system0/brainstem_tick.ts),
[`src/system0/safety_fsm.ts`](./src/system0/safety_fsm.ts),
[`src/system0/execution_kernel.ts`](./src/system0/execution_kernel.ts)

- Runs the 20Hz safety tick.
- Rejects stale intents and unsafe bot state.
- Falls back to `idle` when no safe intent exists.
- Authorizes high-level operations and owns direct application mutations.

Pathfinder and collectblock own their internal movement and collection
mutations. ExecutionKernel does not replace plugin internals.

Native dig and collect operations emit bounded primitive `ActionResult`
records. Runtime exposes latest result to System 1. Repeated failures for one
target pause runtime. Farm goals expose deterministic checkpoints, and runtime
keeps a small bounded named-location set. No provider or database is added.

### Task state

`TaskController` tracks one bounded task with a current step, retry count,
deadline, completion result, or explicit failure. The first verified task is
escaping to safe open ground. Completion comes from Mineflayer world
observation, not provider text.

## Runtime composition

[`src/runtime/agent_runtime.ts`](./src/runtime/agent_runtime.ts) starts after
Mineflayer emits `spawn`. It owns:

- `GoalStore` for the current human goal.
- `TaskController` for current step and completion state.
- `StrategicLoop` for System 2.
- Jev provider for System 1.
- `BrainstemTick` and `ExecutionKernel` for System 0.
- Loopback `ControlServer`.
- Optional `mineflayer-pathfinder` navigation.

The runtime decision cycle runs below the safety tick frequency. It updates the
latest intent; System 0 decides whether that intent can execute.

## Control boundary

Default control host: `127.0.0.1`.

| Endpoint | Purpose |
|---|---|
| `GET /status` | Read runtime, goal, task, lifecycle, path, and error state |
| `POST /goal` | Set one bounded human goal |
| `DELETE /goal` | Clear current goal |
| `POST /pause` | Pause decisions and idle the bot |
| `POST /resume` | Resume decisions unless emergency stop is active |
| `POST /emergency-stop` | Permanently stop decisions until process restart |

Control API exposes goals and lifecycle operations only. It binds to loopback and never exposes direct action dispatch remotely.

## Navigation boundary

**Code:** [`src/runtime/agent_runtime.ts`](./src/runtime/agent_runtime.ts),
[`src/system0/execution_kernel.ts`](./src/system0/execution_kernel.ts)

- Loads the maintained `mineflayer-pathfinder` plugin.
- Configures native `Movements` and submits `GoalNear` goals.
- Consumes pathfinder lifecycle events for observable status and safe reset.
- Detects solid feet/head occupancy on `physicsTick`, searches for a two-block-clear stand, and requests bounded rescue/replanning through System 0.
- On Pathfinder stalls, sends System 1 current primitive world, entity,
  inventory, navigation, and surrounding-block data with all recovery actions
  enabled, including bounded `jump` and native nearby-block `mine`.
- Escape recovery exposes locally verified candidate IDs to Jev. Runtime
  resolves and revalidates the selected stand candidate before sending
  absolute coordinates to Pathfinder. Obstruction coordinates never enter
  `GoalNear`; System 0 mines them only after the bot reaches the stand.
- Loaded `GoalNear` coordinates are rejected unless they have solid support,
  clear feet, and clear head space. Unloaded coordinates remain Pathfinder's
  responsibility after local validation cannot inspect them.
- Clears the active goal through the System 0 idle fail-safe.

## Data and safety invariants

1. Human goals are the control boundary.
2. System 2 emits directives, not actions.
3. System 1 emits validated intents, not Mineflayer calls.
4. System 0 owns safety decisions and execution.
5. The 20Hz path performs no provider network call or plugin wait.
6. Provider messages contain primitive serializable data only.
7. Control API remains loopback-only.
8. Provider keys stay in `.env` and never enter logs.
9. Errors remain visible in `/status`; failures do not become success-shaped
   results.
10. Mineflayer lifecycle faults safe-idle runtime and clear movement controls.

## Decision observability

Runtime writes structured JSONL events. Logs expose goal, directive, selected
intent, safety result, executed action, idle reason, and failures. They do not
attempt to capture hidden model chain-of-thought. Query current events with
`GET /telemetry`; open `/telemetry.html` for an auto-refreshing browser view;
use `TELEMETRY_FILE` for a separate local log path. The API returns the latest
500 events, each with a monotonic sequence number. Position is recorded on
System 0 execution events so movement can be verified from telemetry.
Navigation records planning, waypoint selection, progress, stalls, recovery,
and recovery exhaustion. Status exposes route state and telemetry diagnostics.

## Startup and shutdown

1. Start compatible local Paper `1.21.11`.
2. Run `npm run dev:viewer`.
3. Mineflayer connects and emits `spawn`.
4. Viewer and agent runtime start.
5. Use `npm run goal -- set "..."` to provide a goal.
6. Use `npm run goal -- emergency-stop` for immediate idle and decision stop.
7. Process shutdown stops control server, strategy loop, pathfinder goals, and bot
   mutation before exit.

## Validation

Required gate:

```powershell
npm run typecheck
npm test
npm run build
```

The complete integration test in
[`test/contracts.test.ts`](./test/contracts.test.ts) verifies human goal,
System 2 directive, System 1 intent, and System 0 Mineflayer action flow with
deterministic fakes.

## Current pending work

The complete task ledger is in [`TODO.md`](./TODO.md). Active
verification and blocked items:

| ID | Status | Work |
|---|---|---|
| VC-013 | BLOCKED | Authenticated remote control; deferred by owner, loopback-only control remains |
| VC-017 | BLOCKED | Terrain-aware navigation recovery; no walkable route in loaded grid |
| VC-025 | BLOCKED | Live tower placement unverified after Pathfinder stalls |
| VC-026 | BLOCKED | Live support selection rejected by local server |
| VC-027 | VERIFY | Embedded-block rescue awaits live Paper confirmation |
| VC-029 | VERIFY | Native survival movement awaits live movement confirmation |
| VC-031 | VERIFY | Single-flight navigation awaits bounded-memory live confirmation |
| VC-034 | VERIFY | Pit escape context exists; visual live escape unconfirmed |
| VC-038 | VERIFY | Context-sensitive capability registry live validation |
| VC-040 | VERIFY | Bounded native action results and recovery feedback |
| VC-042 | VERIFY | Ordered farm steps with escape priority |
| VC-045 | VERIFY | Policy-selected survival phase actions |
| VC-047 | VERIFY | Relative navigation observation context |
| VC-049 | VERIFY | Bounded recursive recipe planning |
| VC-050 | VERIFY | Bounded Jev direction hints |
| VC-051 | VERIFY | Dig validated obstructions during embedded recovery |
| VC-053 | VERIFY | Escape underground before farm work |
| VC-054 | VERIFY | Named world identity via `/locraw` |
| VC-055 | VERIFY | Pathfinder route digging enabled |
| VC-056 | VERIFY | Jev movement resolved toward surface |
| VC-057 | VERIFY | Jev narrowed to ambiguous decisions |
| VC-058 | BLOCKED | Bounded task state and observable escape completion |
| VC-059 | BLOCKED | Build and telemetry-verify grounded home goal |

Do not claim provider deadline or 20Hz performance guarantees until
measured enforcement and audit evidence exist.

Home and farm goals now include `place` capability. Construction remains
bounded by the provider's decisions and available inventory; no unbounded
world-editing operation exists.
