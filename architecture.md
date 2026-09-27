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
- Uses OpenCode Zen to produce one concise strategic directive.
- Refreshes on startup, goal changes, and its configured slow interval.
- Does not call Mineflayer or mutate world state.

### System 1: action selection

**Code:** [`src/system1/jev_client.ts`](./src/system1/jev_client.ts),
[`src/system1/firewall.ts`](./src/system1/firewall.ts)

- Receives the System 2 directive and current primitive state.
- Selects one allowed action.
- Validates action shape with TypeBox/Ajv.
- Produces an `Intent` with a state version.
- Runs asynchronously outside the 20Hz safety path.

Allowed actions:

```text
move | attack | mine | eat | craft | idle
```

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
- Optional worker navigation.

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

No direct action endpoint exists. Remote authenticated control is not
implemented and remains blocked pending explicit security approval.

## Worker boundary

**Code:** [`src/workers/grid_extractor.ts`](./src/workers/grid_extractor.ts),
[`src/workers/pathfinder.worker.ts`](./src/workers/pathfinder.worker.ts),
[`src/workers/worker_manager.ts`](./src/workers/worker_manager.ts)

- Extracts a bounded local grid into primitive `Uint16Array` data.
- Transfers the grid buffer to a worker.
- Runs bounded A* search in the worker.
- Returns path coordinates and path length to runtime.

Workers never receive `Bot`, `Block`, `Entity`, or `Vec3` instances. Worker
failure is surfaced through runtime status.

## Data and safety invariants

1. Human goals are the control boundary.
2. System 2 emits directives, not actions.
3. System 1 emits validated intents, not Mineflayer calls.
4. System 0 owns safety decisions and execution.
5. The 20Hz path performs no provider network call or worker wait.
6. Worker messages contain primitive serializable data only.
7. Control API remains loopback-only.
8. Provider keys stay in `.env` and never enter logs.
9. Errors remain visible in `/status`; failures do not become success-shaped
   results.

## Decision observability

Runtime writes structured JSONL events. Logs expose goal, directive, selected
intent, safety result, executed action, idle reason, and failures. They do not
attempt to capture hidden model chain-of-thought. Query current events with
`GET /telemetry`; use `TELEMETRY_FILE` for a separate local log path.

## Startup and shutdown

1. Start compatible local Paper `1.21.11`.
2. Run `npm run dev:viewer`.
3. Mineflayer connects and emits `spawn`.
4. Viewer and agent runtime start.
5. Use `npm run goal -- set "..."` to provide a goal.
6. Use `npm run goal -- emergency-stop` for immediate idle and decision stop.
7. Process shutdown stops control server, strategy loop, workers, and bot
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
| VC-013 | BLOCKED | Authenticated remote control; explicit approval required |
| VC-014 | DONE | Bounded recursive recipe prerequisite planning |
| VC-016 | DONE | Validated block placement through System 0 |

Do not claim provider deadline or 20Hz performance guarantees until measured
enforcement and audit evidence exist.

Home and farm goals now include `place` capability. Construction remains
bounded by the provider's decisions and available inventory; no unbounded
world-editing operation exists.
