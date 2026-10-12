# Agent Operating Instructions — NeuroBlock

## Required agent skills
- Use the installed ponytail skill for every development task, at level FULL. Apply its YAGNI-first ladder, deletion preference, stdlib/native preference, smallest-diff rule, and validation requirement. No unrequested abstractions, scaffolding, dependencies, or configuration.
- Use the installed caveman skill for every development task and every response, at level ULTRA. Terse output that still preserves technical detail, exact commands, errors, warnings, and required documentation.
- Both skills stay active for the whole session and every task in it. Use normal clarity for security, irreversible actions, and ambiguous multi-step instructions.

## Project identity
- **Repository**: NeuroBlock (not VoxelCortex; VoxelCortex is the runtime name)
- **Runtime name**: VoxelCortex
- **Status**: Local active-agent development

## Critical architecture boundaries
- **System 0** (`src/system0/execution_kernel.ts`) is the **sole** layer allowed to call Mineflayer mutation methods. No other code path — not System 1, not System 2, not plugins — may execute direct Mineflayer calls.
- System 0 must **not** perform network I/O, JSON parsing, heavy computation, or plugin waits on its critical 20Hz path.
- Human goals enter System 2 → System 1 emits validated intents → System 0 decides safe execution.
- Pathfinder and collectblock own navigation internals; application code passes only validated primitive targets into System 0.
- **Use TypeBox/Ajv for network intent validation; do not introduce Zod here.**

## Start every task
1. Read `TODO.md` for the durable task ledger.
2. Read `PROJECT_MASTER.md` for architecture and runtime state.
3. Inspect relevant source, tests, and configuration.
4. State the observable acceptance condition internally before implementation.

## Work protocol
1. Prefer the smallest complete change that crosses every required layer.
2. Preserve the System 0/System 1/System 2 ownership model.
3. Reuse existing types, adapters, validators, and lifecycle helpers.
4. Do not add providers, databases, frameworks, or configuration modes unless acceptance requires them.
5. Keep changes narrow; do not rewrite unrelated code or formatting.
6. Update directly related documentation and the task ledger.
7. After every implementation, update `TODO.md`; when behavior, architecture, commands, configuration, invariants, limitations, or operations change, also update `PROJECT_MASTER.md` and this file.

## Exact developer commands (from package.json)
- `npm install` — install dependencies
- `npm run typecheck` — `tsc --noEmit -p tsconfig.json` (minimum gate)
- `npm run build` — `tsc -p tsconfig.json`
- `npm test` — `node --test --import tsx test/contracts.test.ts` (31 contract tests only; no live server needed)
- `npm run goal -- set "..."` — set a human goal via CLI
- `npm run goal -- status` — inspect current goal
- `npm run goal -- clear` — clear the human goal
- `npm run dev:viewer` — starts local Paper + browser viewer + agent runtime
- `npm run diagnose:jev` — verify Jev client configuration
- `npm run diagnose:opencode` — verify OpenCode client configuration
- `npm run probe:opencode-free` — probe free OpenCode model availability
- `npm run audit:20hz` — 20Hz allocation and latency audit

**Minimum gate for every code change**:
1. `npm run typecheck`
2. `npm test`
3. `npm run build`

## Repository structure (key entrypoints)
- `src/index.ts` — re-exports all public APIs
- `src/system0/execution_kernel.ts` — **sole Mineflayer mutation boundary**; see tests for expected behavior
- `src/system1/firewall.ts` — `validateLLMIntent()` guards every inbound LLM action
- `src/system1/jev_client.ts` — TypeSafe SDK Jev client; MIN_ACTION_CONFIDENCE = 0.6
- `src/system2/strategic_loop.ts` — produces `StrategicObjective` directives
- `src/runtime/agent_runtime.ts` — composes providers, goal store, brainstem, control API
- `src/core/capabilities.ts` — single source of truth for validated actions and Mineflayer semantics
- `src/core/types.ts` — TypeBox/Ajv schemas, Action, Intent, IntentTarget, AgentStatus
- `src/control/control_server.ts` — HTTP control API (loopback only); never exposes direct action endpoints
- `test/contracts.test.ts` — 31 tests using fake Mineflayer bots; no live Paper required

## Environment
- Copy `.env.example` to `.env`; **never commit `.env`** (contains TYPESAFE_API_KEY, JEV_API_URL, JEV_MODEL, OPENCODE_API_URL, OPENCODE_API_KEY, OPENCODE_MODEL).
- `.env` is read via `env-file-if-exists` in package.json scripts.
- Minecraft: `localhost:25565`, Paper 1.21.11 only; `online-mode=false`, development only.
- Control API binds to `127.0.0.1` by default; no remote access.

## Testing quirks
- All 31 tests in `test/contracts.test.ts` use **fake Mineflayer bots** — no live Paper or Minecraft server needed.
- Tests cover: firewall validation, capability registry, strategic loop, circuit breaker, ring buffer, telemetry parsing, OpenCode Zen client, goal store, task controller, System 0 execution (move, jump, dig, collect, place, flee, drop, equip, sleep, activate), control API boundaries, goal-to-action flow, attack fallback to `bot.nearestEntity`, and more.
- Tests assert specific error codes: `DIG_TARGET_CHANGED`, `DIG_UNBREAKABLE`, `ACTION_TIMEOUT`, `DIG_FAILED`, `MISSING_PLUGIN`.
- Runtime decision cycles are **single-flight**: 750ms cadence skips a new provider request while previous is pending.
- `chooseSurvivalAction()` in `survival_policy.ts` sequences escape → gather → farm → jump based on primitive state only.

## Important constraints
- **Never commit `.env`, API keys, server credentials, or generated secrets.**
- **Local control binds to loopback unless an explicit security design is added.** The control API at `127.0.0.1:8787` never exposes direct action endpoints — only `/goal`, `/pause`, `/resume`, `/emergency-stop`, `/status`, `/telemetry`.
- **System 0 jump pulse is bounded**: 350ms forward+jump, then controls cleared. System 1 must not issue unbounded jump requests.
- **Escape completion requires solid support, clear feet/head blocks, and eight clear blocks above the bot.** System 1 receives this primitive state but System 0 owns execution.
- **Provider calls never execute inside the 20Hz tick.** Strict provider deadline enforcement is unimplemented; runtime abandons a Jev request after 600ms and falls back locally.
- **LLM responses are validated and stale responses are discarded.** Provider messages contain primitive serializable data only — never Mineflayer objects.
- **Errors are observable; do not silently convert failures into success.** Mineflayer death, kick, end, or error enters safe idle/emergency stop and remains visible in status and telemetry.
- **Only pit escape has an initial completion predicate.** Village, shelter, farm, and combat semantic completion remain unimplemented.
- **Current local world position has no walkable route in the loaded 16³ grid.** Navigation safely pauses with `Navigation: no-route`; move the bot to traversable terrain before live progress validation.
- **Capability registry** (`inferRelevantCapabilities()`) drives firewall, Jev criteria, System 2 data-only hints, narrowed Jev action menus, and System 0 dispatch. It is the single source of truth.

## Safe stop conditions
Stop and ask for direction only when:
- The owner must choose between materially different architectures.
- The change would expose the control API remotely.
- A destructive world/data operation is requested.
- Required external credentials or an undocumented provider contract are unavailable and cannot be safely mocked.
- Existing evidence contradicts the requested behavior in a way that changes security or ownership.

## Commit and PR workflow
- After ANY change, create a distinctive commit. Distinctive means a Conventional Commit message stating the specific intent of that change, not a generic update/fix/wip.
- After a MAJOR change — new subsystem, multi-file feature, architecture or ownership-boundary change — open a PR instead of merging directly.
- A PR must be validated before merge: CI green, plus a local run of `npm test`, `npm run typecheck`, and `npm run build`.
- Fix any failures found during validation, then merge the PR back into main.
- Never merge a major change directly to main without passing through a validated PR.

## Session lifecycle

- When a worker's task is complete and verified, clean it up promptly. Never leave a finished session sitting idle.
- Use ao session cleanup to reclaim terminated workspaces, and ao session kill for any session still running with nothing left to do.
- Move every task to an appropriate terminal state: COMPLETED when done and verified; BLOCKED when it cannot proceed, always with a stated blocking reason; IN_REVIEW when a PR is open awaiting checks; MERGED when the PR has landed.
- Report status by classifying every session explicitly as completed, in progress, or blocked. Never present an idle session as active work.

Routine implementation errors, type errors, test failures, and provider diagnostic failures should be investigated and fixed autonomously when the approved architecture remains intact.