# VoxelCortex Architecture

## Purpose

VoxelCortex is a local-first Minecraft agent. Human goals enter a controlled
planning path:

```text
Human goal -> System 2 directive -> System 1 intent -> System 0 safety -> Mineflayer
```

Human input never becomes a direct Minecraft action.

## Runtime layers

### System 2: strategy

**Code:** [`src/system2/strategic_loop.ts`](./src/system2/strategic_loop.ts),
[`src/system2/opencode_client.ts`](./src/system2/opencode_client.ts)

- Reads the current human goal and primitive observations.
- Uses OpenCode Zen to produce one concise strategic directive, then maps it to a typed `StrategicObjective`.
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
- Owns the only allowed Mineflayer mutation boundary.

Only `ExecutionKernel` may call Mineflayer mutation methods such as movement,
attack, dig, consume, craft, or control-state clearing.

## Runtime composition

[`src/runtime/agent_runtime.ts`](./src/runtime/agent_runtime.ts) starts after
Mineflayer emits `spawn`. It owns:

- `GoalStore` for the current human goal.
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
| `GET /status` | Read runtime, goal, lifecycle, path, and error state |
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
  enabled, including bounded `jump`.
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

| ID | Status | Work |
|---|---|---|
| VC-010 | DONE | JSONL telemetry export and `/telemetry` count endpoint |
| VC-012 | DONE | 1000-sample 20Hz p95 audit; current run 0.002 ms |
| VC-013 | BLOCKED | Authenticated remote control; deferred by owner, loopback-only control remains |
| VC-014 | DONE | Bounded recursive recipe prerequisite planning |
| VC-016 | DONE | Validated block placement through System 0 |
| VC-025 | BLOCKED | Live tower placement remains unverified after Pathfinder stalls |
| VC-026 | BLOCKED | Live support selection still rejected by local server |
| VC-027 | VERIFY | Embedded-block rescue awaits live Paper confirmation |
| VC-029 | VERIFY | Native survival movement awaits live movement confirmation |
| VC-031 | VERIFY | Single-flight navigation awaits bounded-memory live confirmation |
| VC-034 | VERIFY | Pit escape context exists; visual live escape remains unconfirmed |

Do not claim provider deadline or 20Hz performance guarantees until measured
enforcement and audit evidence exist.

Home and farm goals now include `place` capability. Construction remains
bounded by the provider's decisions and available inventory; no unbounded
world-editing operation exists.
