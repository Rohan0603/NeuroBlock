# Agent Operating Instructions

These instructions make VoxelCortex safe for hands-off agentic development.
They apply to coding agents working in this repository.

## Required agent skills

Use installed `ponytail` skill during every development task. Apply its
YAGNI-first coding ladder, deletion preference, stdlib/native preference,
smallest-diff rule, and validation requirement. Do not add abstractions,
scaffolding, dependencies, or configuration without acceptance evidence.

Use installed `caveman` skill during every development task and response.
Keep output terse while preserving technical detail, exact commands, errors,
warnings, and required documentation. Use normal clarity for security,
irreversible actions, and ambiguous multi-step instructions.

## Start every task

1. Read [`PROJECT_MASTER.md`](./PROJECT_MASTER.md).
2. Read [`TODO.md`](./TODO.md).
3. Inspect the relevant source, tests, configuration, and existing changes.
4. Identify the task ID or add one before editing.
5. State the observable acceptance condition internally before implementation.

## Work protocol

1. Prefer the smallest complete change that crosses every required layer.
2. Preserve the System 0/System 1/System 2 ownership model.
3. Reuse existing types, adapters, validators, and lifecycle helpers.
4. Do not add providers, databases, frameworks, or configuration modes unless
   acceptance requires them.
5. Keep changes narrow; do not rewrite unrelated code or formatting.
6. Update directly related documentation and the task ledger.
7. After every implementation, update every relevant project document in the
   same change. At minimum update [`TODO.md`](./TODO.md); when behavior,
   architecture, commands, configuration, invariants, limitations, or
   operations change, also update [`PROJECT_MASTER.md`](./PROJECT_MASTER.md),
   [`README.md`](./README.md), `.env.example`, and any applicable tests or
   source documentation. Documentation updates must not be deferred.

## Architecture rules

- Only [`src/system0/execution_kernel.ts`](./src/system0/execution_kernel.ts)
  may call Mineflayer mutation methods.
- System 0 must not perform network I/O, JSON parsing, heavy computation, or
  plugin waits on its critical path.
- Human goals enter System 2. System 2 emits strategy. System 1 emits
  validated intents. System 0 decides whether execution is safe.
- Pathfinder and collectblock own navigation internals; application code passes
  only validated primitive targets into System 0.
- Use TypeBox/Ajv for network intent validation; do not introduce Zod here.
- Keep provider keys in `.env`; never print, commit, or paste them into logs.
- The local Paper server must stay loopback/offline-only for development.
- Any new direct action endpoint requires an explicit security review and
  approval; goal input is the preferred control boundary.

## Failure handling

- Surface errors with useful provider/module context.
- Do not use broad catches that make failed work look successful.
- Preserve circuit breakers, single-flight behavior, deadlines, and stale
  response rejection.
- If a provider is unavailable, use a deterministic fake for tests and report
  the live integration limitation; do not weaken safety to keep moving.
- Stop and mark `BLOCKED` when a requested change contradicts ownership,
  safety, security, or the task acceptance criteria.

## Validation protocol

Run the smallest relevant checks while iterating, then run the full required
gate before completion:

```powershell
npm run typecheck
npm test
npm run build
```

For runtime/provider changes also run:

```powershell
npm run diagnose:jev
npm run diagnose:opencode
npm run dev:viewer
```

For the live viewer, verify:

- Mineflayer reaches `spawn`.
- `http://localhost:3000` returns HTTP 200.
- `http://127.0.0.1:8787/status` reports the connected runtime.
- Shutdown leaves no unexpected control or bot process.

## Task completion protocol

Before declaring a task complete:

1. Confirm every acceptance condition.
2. Review the diff for unrelated changes and secret leakage.
3. Update [`TODO.md`](./TODO.md) to `DONE`, `VERIFY`, or `BLOCKED`.
4. Update every relevant project document before reporting completion; do not
   leave documentation updates as a follow-up task.
5. Record validation commands and material limitations.
6. Update [`PROJECT_MASTER.md`](./PROJECT_MASTER.md) if architecture,
   commands, invariants, or known limitations changed.
7. Report changed files, tests, documentation updates, and remaining work
   concisely.

## Commit protocol

Use Conventional Commits when commits are requested. Use configured user Git
identity as commit author. Do not add Copilot name, email, or co-author trailer.
Do not impersonate a different human identity or alter Git identity settings.

Never commit `.env`, API keys, server credentials, or generated secrets.

## Safe stop conditions

Stop and ask for direction only when:

- The owner must choose between materially different architectures.
- The change would expose the control API remotely.
- A destructive world/data operation is requested.
- Required external credentials or an undocumented provider contract are
  unavailable and cannot be safely mocked.
- Existing evidence contradicts the requested behavior in a way that changes
  security or ownership.

Routine implementation errors, type errors, test failures, and provider
diagnostic failures should be investigated and fixed autonomously when the
approved architecture remains intact.
