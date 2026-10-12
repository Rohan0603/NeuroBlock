# VoxelCortex

VoxelCortex is a Node.js 22+ Minecraft agent skeleton split into a synchronous
20Hz brainstem, asynchronous LLM control plane, native Mineflayer plugins
computation, and a slower strategic loop.

See [architecture.md](./architecture.md) for ownership boundaries, runtime
flow, control endpoints, plugin ownership, invariants, and pending work.
See [reference.md](./reference.md) for the Mindcraft LLM and Mineflayer
integration reference used to guide VoxelCortex decisions.

## Development

```powershell
npm install
npm run typecheck
npm run build
npm test
```

## Quick start

Use Paper `1.21.11` and Java 25. Keep Paper loopback-only with
`online-mode=false` for local development.

```powershell
Set-Location .\server-1.21.11
java -Xms1G -Xmx2G -jar paper.jar --nogui
```

In a second terminal:

```powershell
Set-Location ..
$env:MINECRAFT_HOST = "localhost"
$env:MINECRAFT_PORT = "25565"
$env:MINECRAFT_USERNAME = "VoxelCortexBot"
$env:MINECRAFT_VERSION = "1.21.11"
npm run dev:viewer
```

Open <http://localhost:3000>. Use Java Minecraft client `1.21.11` to join
`localhost:25565`. Do not use Forge `1.21.1` or Paper `26.2` with this setup.

## Provider diagnostics

These commands make one real, minimal API request and return machine-readable
JSON for an agent or CI troubleshooting step. They never print API keys.

```powershell
npm run diagnose:jev
npm run diagnose:opencode
npm run probe:opencode-free
```

Each result includes `provider`, `ok`, `latencyMs`, and an actionable `error`
when the request fails. Jev is tested with a single legal `idle` choice;
OpenCode Zen is tested with a concise safe-state directive request. A nonzero
exit code means the provider is unavailable, misconfigured, or returned an
invalid response.

`probe:opencode-free` tests every documented free text model, reports each
endpoint/status/latency, and recommends the fastest successful model. It never
changes `.env`; apply the recommendation only after reviewing the JSON output.

## Free local visual development

For a local PaperMC server configured with `online-mode=false`, start the bot
and browser viewer with:

```powershell
$env:MINECRAFT_HOST = "localhost"
$env:MINECRAFT_PORT = "25565"
$env:MINECRAFT_USERNAME = "VoxelCortexBot"
$env:VIEWER_PORT = "3000"
npm run dev:viewer
```

Open <http://localhost:3000>. The viewer is a development-only adapter; it
does not change brainstem, plugin ownership, or production authentication
behavior. Set `MINECRAFT_VERSION` when the server version cannot be inferred.

After the bot spawns, `dev:viewer` also starts the active runtime. Human goals
go to System 2 first; System 2 produces a bounded task plan, the task controller
tracks progress, and System 1 selects one validated action only when
deterministic policy has no answer. System 0 gates application operations;
Pathfinder and collectblock perform their plugin-owned internals.

Set or inspect a goal from another terminal:

```powershell
npm run goal -- set "Find a village and build a shelter"
npm run goal -- status
npm run goal -- clear
npm run goal -- pause
npm run goal -- resume
npm run goal -- emergency-stop
```

The equivalent loopback API is `GET /status`, `GET /telemetry`, `POST /goal` with
`{"goal":"..."}`, `DELETE /goal`, `POST /pause`, `POST /resume`, and
`POST /emergency-stop` on `http://127.0.0.1:8787`. Status includes lifecycle,
decision count, and latest runtime error for troubleshooting. The API never
exposes direct bot actions.

Runtime events append as JSON Lines to `telemetry.jsonl` by default. `GET /telemetry` reads persisted events. Set
`TELEMETRY_FILE` to choose another local path. Run `npm run audit:20hz` to
measure brainstem p95 latency against the 50 ms tick budget.

Open `http://127.0.0.1:8787/telemetry.html` for an auto-refreshing browser log
with the latest 200 events.

Telemetry endpoint returns latest 500 events by default. Each event includes a
monotonic `sequence` inside `data`, making dropped, reordered, or repeated
events easy to detect. `system0.execution` also records bot position; compare
successive positions to prove movement rather than trusting action labels.

Useful troubleshooting sequence:

```powershell
Invoke-WebRequest http://127.0.0.1:8787/status
Invoke-WebRequest http://127.0.0.1:8787/telemetry
npm run diagnose:jev
npm run diagnose:opencode
npm run audit:20hz
```

Expected status: `connected: true`, `paused: false`, and
`emergencyStopped: false`. If status is unavailable, start Paper first, then
restart `npm run dev:viewer`. If provider diagnostics fail, inspect `.env`
names and keys without printing keys to logs.

`/status` includes `task` with current step, retry count, deadline, and
completion or failure state. The first task is pit escape to safe open ground.

Useful event types:

- `system2.directive`: goal and selected strategic plan/directive.
- `task.started`, `task.completed`, `task.failed`: bounded task lifecycle.
- `system1.request`: directive sent for action selection.
- `system1.decision`: System 1 source (`survival-policy` or `jev`) and
  selected action.
- `system1.intent`: validated action and target.
- `system0.safety`: safety result and intent freshness.
- `system0.execution`: executed action or idle reason.
- `decision.failed`: provider/runtime failure.
- `home.anchor.selected`, `home.progress`, `home.verified`: native shelter
  anchor, placed-block count, and final world-observation proof for home goals.

`system0.execution` includes bot position, so compare positions across events to
confirm movement. Logs record decisions and directives, not hidden provider
chain-of-thought.

During escape recovery, runtime sends Jev a primitive list of locally verified
stand candidates. Jev returns a candidate ID, never raw coordinates. Runtime
resolves and revalidates that ID before submitting an absolute Pathfinder goal.
`GoalNear` accepts stand positions only: support must be solid and feet/head
space must be clear. Runtime submits obstruction blocks to `bot.dig`, never to
Pathfinder. The bot must arrive beside an obstruction before digging it.

Navigation emits planning, waypoint, progress, stall, and recovery events. A
route needs support and feet/head clearance. If physics-tick observation finds
the bot embedded in a solid feet/head block, runtime searches native
`findBlocks` results for a two-block-clear stand, asks System 0 for one bounded
jump pulse, and replans with `GoalNear`. After three rescue attempts, runtime
pauses and `/status` reports the navigation fault. Status also reports
malformed telemetry records and write failures when observed.

Survival navigation keeps native Pathfinder jump, vine-climb, and route-digging
behavior enabled, uses planner-controlled one-block jumps, disables parkour,
free motion, sprinting, and pillaring, and limits drops to two blocks. Native
search is bounded to 16 blocks with 250 ms think and 10 ms tick budgets.
System 0 does not replace an active Pathfinder goal until movement stops or
fails, preventing overlapping native searches.
System 1 can select bounded `jump` action. Runtime supplies local terrain
cells, solid supports, feet/head blocks, and navigation state. System 0 owns
350 ms jump pulse.
For pit escape, System 1 can select `mine`; runtime resolves a nearby solid
block with native `bot.findBlock`, then System 0 digs that exact block through
native `bot.canDigBlock` and `bot.dig`.
Goals that explicitly request leaving a mine enter an escape phase first:
runtime permits bounded nearby mining, then issues movement toward open terrain
before farm/build actions. This prevents farm crafting from blocking rescue.
Movement targets prefer the highest nearby stand with solid support, clear
feet/head space, and sky light. If no valid surface is loaded, runtime targets
eight blocks upward so Pathfinder can dig toward the surface.
System 2 marks farm escape directives with ordered steps
`escape`, `gather`, `farm`; System 1 receives these steps as primitive
objective data while Mineflayer supplies block/entity observation and Pathfinder
supplies route status.
System 1 survival policy selects `mine`, `jump`, `move`, `collect`, or `craft`
from those steps plus `escapeDigCount`, `onGround`, surrounding solid blocks,
and current checkpoint. Jev remains fallback for actions without a deterministic
survival rule.
Deterministic actions do not call Jev. Jev action answers below 0.6 confidence
fall back locally. Requests time out after 600 ms. Pin `JEV_MODEL` to a
version for reproducible behavior.
`/status` and `/telemetry` report Jev usage, timeouts, low-confidence answers,
and whether Jev changed the final action.
Escape mining filters targets with Mineflayer `canDigBlock` and uses
`bot.dig(block, true)` so native reach and aiming checks run at execution time.
After `noPath`, System 1 allows at most 12 escape digs. Runtime scores the
four cardinal directions from native `blockAt` observations, clears the
best direction, then retries Pathfinder movement.
System 1 receives relative terrain coordinates and compact navigation
delta/distance/direction fields. System 0 keeps absolute coordinates for final
target validation and Mineflayer execution.
Jev may add a validated cardinal direction hint with distance 1-8. Runtime
resolves that hint to a local target; Jev never supplies unrestricted mutation
coordinates.
Escape ends only when native block queries confirm solid support, clear
feet/head space, and eight blocks of vertical headroom.
The external [MineflayerTutorials](../MineflayerTutorials/scripts/09-jumper-bot.mjs)
pattern is applied only inside System 0: bounded `forward` plus `jump`, then
control reset. Tutorial reconnect and event logging patterns remain external
reference; credentials and direct chat control are not copied.
Runtime stays idle until human goal input arrives; startup no longer launches
unbounded exploratory movement.
Runtime loads Pathfinder before collectblock so collectblock reuses one
navigation plugin instance.
Pathfinder route digging is enabled with `Movements.canDig = true`; direct
System 1 mining remains validated by System 0.

When Pathfinder reports a stall, System 1 receives current position, health,
inventory, entity distances, feet/head blocks, navigation fault, and nearby
solid block coordinates. System 1 receives the full recovery action set and
chooses the next validated action. A fourth failed recovery pauses runtime.

If status reports `Navigation: no-route` after chunk loading, move the bot to
traversable terrain before retrying. The runtime deliberately does not mine or
issue an unvalidated escape action to force progress.

System 0 reports bounded `lastExecution` results for native dig and collect
operations. Results include success, error code, retryability, target, and
completion time. Three failures for one target pause runtime. System 1 receives
the latest result in its primitive observation and can choose recovery.

Manual mining uses optional `mineflayer-tool` integration when `bot.tool` is
loaded; otherwise Mineflayer keeps its current held item behavior. No tool
plugin is installed by default. Farm goals expose bounded checkpoints such as
`gather_seeds`, `craft_hoe`, and `prepare_and_plant`. Runtime keeps at most
eight primitive named locations, including `spawn` and `last_safe_stand`.

## Provider API configuration

Provider credentials belong in the ignored root `.env`, copied from
[`.env.example`](./.env.example):

- **System 1 — Jev:** `TYPESAFE_API_KEY`, optional `JEV_API_URL`, and
  `JEV_MODEL`. This uses the TypeSafe SDK's `systemOne()` and `choice()`
  primitives for fast intent decisions. The current runtime adapter is
  `src/system1/jev_client.ts`. Strict generic deadline enforcement is not yet
  active; add it with tests before claiming that guarantee.
- **System 2 — OpenCode Zen:** `OPENCODE_API_URL`, `OPENCODE_API_KEY`, and
  `OPENCODE_MODEL`. This uses the documented Zen Responses API and is the
  slow strategic provider; it must only feed strategic directives into System
  1.

The Jev adapter is implemented in
[`src/system1/jev_client.ts`](C:/Users/ponna/Project/NeuroBlock/src/system1/jev_client.ts)
using the same SDK pattern as the referenced project. The OpenCode Zen adapter
is implemented in
[`src/system2/opencode_client.ts`](C:/Users/ponna/Project/NeuroBlock/src/system2/opencode_client.ts)
and calls the direct Zen endpoint:

```env
OPENCODE_API_URL=https://opencode.ai/zen/v1/responses
OPENCODE_MODEL=gpt-5.5
OPENCODE_API_KEY=your_opencode_zen_key
```

The v2 docs list the model-specific Zen endpoints. Use the Responses endpoint
for GPT models and set the matching model ID. The API key stays server-side
and is never sent through the Minecraft 20Hz loop. Do not paste keys into
source files or commit `.env`.

The implementation is intentionally adapter-oriented: Mineflayer, LLM, and
strategy integrations can be exercised with fakes without requiring a live
Minecraft server or provider credentials. Navigation uses the maintained
`mineflayer-pathfinder` plugin when enabled by the active runtime.

Home, farm, and shelter goals currently support movement, mining, bounded
crafting, and validated block placement. Completion depends on inventory,
available recipes, safe terrain, and provider action choices; the agent does
not perform unrestricted world editing.

Navigation submits native `GoalNear` targets and reports pathfinder events.
The browser viewer camera may not follow automatically; use the viewer camera
controls or inspect `/status` and `/telemetry.html` to confirm movement and
decisions.

## Invariants

- `ExecutionKernel` is the only module that mutates Mineflayer state.
- The brainstem tick performs only synchronous safety and intent checks.
- Pathfinder movement remains bounded by its configured native `Movements`.
- LLM responses are schema-validated and stale decisions are rejected.
- Repeated digging is single-flight to prevent overlapping Mineflayer dig
  operations.
- Telemetry records system decisions without storing hidden model
  chain-of-thought.

The authoritative architecture constraints and phased delivery requirements are
in [`plan.md`](./plan.md).

## Agentic development handoff

The durable project handoff is in
[`PROJECT_MASTER.md`](./PROJECT_MASTER.md). Agent operating rules are in
[`AGENTS.md`](./AGENTS.md), and the shared task/goal ledger is in
[`TODO.md`](./TODO.md). Agents should read all three before changing code.
