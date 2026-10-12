# VoxelCortex Implementation Plan

## Target

Build one real Mineflayer task agent:

```text
human goal
  -> validated LLM plan
  -> deterministic task state
  -> Jev only when tactical choice is unclear
  -> Mineflayer plugin operation
  -> observed result
  -> success or failure
```

Mineflayer and its plugins own world interaction. System 0 authorizes
high-level operations and handles safety. It does not replace plugin internals.

## Delivery order

### 1. Freeze scope

Keep Mineflayer, Pathfinder, collectblock, LLM planning, Jev fallback,
loopback control, and telemetry. Freeze new capabilities, recovery heuristics,
remote control, multi-goal planning, combat intelligence, and broad autonomy.

### 2. Add task state

Track one bounded task with:

- goal
- current step
- attempt count
- start and deadline
- explicit failure
- completion result

Supported steps:

```text
escape | navigate | gather | craft | build | verify | complete | failed
```

Expose task state through `/status` and telemetry.

### 3. Prove one live task

First task: escape a pit and reach safe open ground.

Success requires solid support, clear feet/head blocks, required vertical
clearance, and stable observation. Failure requires timeout, retry exhaustion,
disconnect, death, or repeated action failure.

### 4. Structure System 2

Replace free-form directive interpretation with a small TypeBox/Ajv-validated
task plan. LLM proposes supported steps. Runtime rejects unknown or malformed
plans.

### 5. Keep Jev tactical

Deterministic policy runs first. Jev runs only when no deterministic action
exists. Validate action and target output. Provider failure produces safe
fallback or task failure, never success.

### 6. Clarify execution boundary

System 0 validates and authorizes high-level operations. Pathfinder and
collectblock perform their internal mutations. Plugin results return to task
state.

### 7. Reduce runtime only after behavior works

Move only task state, transitions, and completion predicates out of
`AgentRuntime`. Do not create a general workflow framework.

### 8. Add second task

Only after live escape succeeds:

```text
navigate -> collect -> verify inventory -> complete
```

Use collectblock. Add crafting only after gathering completes reliably.

## Definition of done

- One task completes live.
- One task fails safely.
- Completion comes from world evidence.
- LLM plans steps but cannot execute directly.
- Jev is optional tactical fallback.
- Mineflayer plugins perform world operations.
- System 0 gates operations without replacing plugins.
- `/status` reports step, result, failure, and completion.
- Tests cover task transitions and completion predicates.
- Live validation is recorded in `TODO.md`.

## Explicit non-goals

No generic planner, behavior tree, custom pathfinding, vector database,
multi-agent coordination, remote control, or “do anything” mode.
