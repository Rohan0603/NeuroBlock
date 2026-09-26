# VoxelCortex

VoxelCortex is a Node.js 22+ Minecraft agent skeleton split into a synchronous
20Hz brainstem, an asynchronous LLM control plane, isolated worker
computation, and a slower strategic loop.

See [architecture.md](./architecture.md) for ownership boundaries, runtime
flow, control endpoints, worker isolation, invariants, and pending work.

## Development

```powershell
npm install
npm run typecheck
npm run build
npm test
```

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
does not change the brainstem, worker boundary, or production authentication
behavior. Set `MINECRAFT_VERSION` when the server version cannot be inferred.

After the bot spawns, `dev:viewer` also starts the active runtime. Human goals
go to System 2 first; System 2 produces a strategic directive, and System 1
turns that directive plus current state into a validated immediate action.
System 0 remains the final safety and execution boundary.

Set or inspect a goal from another terminal:

```powershell
npm run goal -- set "Find a village and build a shelter"
npm run goal -- status
npm run goal -- clear
npm run goal -- pause
npm run goal -- resume
npm run goal -- emergency-stop
```

The equivalent loopback API is `GET /status`, `POST /goal` with
`{"goal":"..."}`, `DELETE /goal`, `POST /pause`, `POST /resume`, and
`POST /emergency-stop` on `http://127.0.0.1:8787`. Status includes lifecycle,
decision count, and latest runtime error for troubleshooting. The API never
exposes direct bot actions.

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

The implementation is intentionally adapter-oriented: Mineflayer, LLM, worker,
and strategy integrations can be exercised with fakes without requiring a live
Minecraft server or provider credentials. Worker navigation runs through
bounded A* when enabled by the active runtime.

## Invariants

- `ExecutionKernel` is the only module that mutates Mineflayer state.
- The brainstem tick performs only synchronous safety and intent checks.
- Future worker messages must contain primitive serializable data only.
- LLM responses are schema-validated and stale decisions are rejected.

The authoritative architecture constraints and phased delivery requirements are
in [`plan.md`](./plan.md). The implementation plan for unattended development
is maintained in the session handoff artifact rather than committed to the
repository.

## Agentic development handoff

The durable project handoff is in
[`PROJECT_MASTER.md`](./PROJECT_MASTER.md). Agent operating rules are in
[`AGENTS.md`](./AGENTS.md), and the shared task/goal ledger is in
[`TODO.md`](./TODO.md). Agents should read all three before changing code.
