```markdown
# Project VoxelCortex — Implementation Master Plan

**Target Audience:** Agentic AI Developer (GitHub Copilot, Cursor, Claude)
**Role:** Principal Node.js Game Server Architect
**Objective:** Build a real-time, 3-tier cognitive Minecraft agent using `mineflayer` and an ultra-low latency LLM provider. 

**Prime Directive:** **The Node.js event loop is sacred.** Pathfinding, LLM network requests, and heavy JSON parsing must NEVER block the main 20Hz (50ms) physics tick. The LLM is an asynchronous, unreliable advisor, not a synchronous controller.

---

## 1. Architecture & Directory Structure

The system is strictly divided into 4 domains. **Do not bleed logic between these domains.**

```text
src/
├── core/
│   ├── perf_monitor.ts       (perf_hooks event loop tracker)
│   └── types.ts              (Shared interfaces, IntentEpoch, GridSnapshot)
├── system0/                  (BRAINSTEM - Synchronous, 20Hz)
│   ├── execution_kernel.ts   (Exclusive wrapper for bot actions)
│   ├── safety_fsm.ts         (Lava/Fall/Hostile reactive logic)
│   └── brainstem_tick.ts     (Main 50ms interval loop)
├── system1/                  (CEREBELLUM - Asynchronous, Network)
│   ├── llm_client.ts         (Single-flight fetch, deadlines)
│   ├── circuit_breaker.ts    (Closed, Open, Half-Open states)
│   └── firewall.ts           (TypeBox + Ajv compiled schema)
└── workers/                  (HEAVY COMPUTE - Thread Pool)
    ├── grid_extractor.ts     (Main thread: bot -> Uint16Array)
    ├── worker_manager.ts     (Thread lifecycle & postMessage)
    └── pathfinder.worker.ts  (Offloaded A* and Context Compression)

```

---

## 2. Hard Engineering Constraints (AI Developer: Strictly Enforce These)

1. **Zero-Avoidable Allocations in System 0:** The 20Hz tick (`brainstem_tick.ts`) must not use `new`, `Array.map`, `JSON.parse`, or `JSON.stringify`. Depend on pre-allocated buffers and primitive state checks.
2. **Worker Isolation:** **NEVER** pass `bot`, `Block`, `Entity`, or `Vec3` objects to `worker_threads`. Extract block IDs to a flat `Uint16Array` and use `ArrayBuffer` transfer lists to ensure zero-copy memory overhead.
3. **LLM is Disposable (Strict Deadlines):** A request has a 350ms soft deadline and a 500ms hard E2E deadline. If the LLM takes 501ms, the response is dropped silently.
4. **No Zod for Network Boundaries:** Use `@sinclair/typebox` and `ajv` to compile the JSON schema once at startup. Zod is banned in `system1/firewall.ts` to guarantee sub-millisecond execution.
5. **Execution Kernel Monopoly:** Only `ExecutionKernel` is allowed to call `bot.setControlState`, `bot.attack`, etc. System 1 only produces `Intent` JSON. System 0 verifies and executes.

---

## 3. Phase 1: System 0 (The Brainstem) & Diagnostics

**Goal:** Establish the main event loop, execution boundary, and performance monitoring.

### 3.1. Performance Monitor (`src/core/perf_monitor.ts`)

* Implement `monitorEventLoopDelay({ resolution: 1 })` and `performance.eventLoopUtilization()`.
* Log p50, p95, p99, max delay, and ELU every 1000ms.
* **Threshold:** If p95 event loop delay > 10ms, log a critical warning.

### 3.2. The Execution Kernel (`src/system0/execution_kernel.ts`)

* Create an `ExecutionKernel` class that receives the `mineflayer.Bot` instance.
* Expose strictly typed methods: `move(intent)`, `attack(targetId)`, `dig(blockId)`, `eat()`.
* This is the *only* file allowed to import and call `mineflayer` mutation methods.

### 3.3. Brainstem Tick (`src/system0/brainstem_tick.ts`)

* Hook into `bot.on('physicsTick')` or run `setInterval` exactly every 50ms (20Hz).
* **Flow:**
1. Run `SafetyFSM` (check health, nearby hazards).
2. Read the latest `IntentEpoch` from System 1.
3. Run `isCurrent(epoch)` to ensure the LLM response isn't stale (check `stateVersion` and `requestId`).
4. Pass valid intents to `ExecutionKernel`.



---

## 4. Phase 2: System 1 (The LLM Firewall & Network)

**Goal:** Safely request, receive, and validate AI commands without crashing or blocking.

### 4.1. Compiled Firewall (`src/system1/firewall.ts`)

* Define `IntentSchema` using `@sinclair/typebox`:
```typescript
const IntentSchema = Type.Object({
  action: Type.Union([Type.Literal('move'), Type.Literal('attack'), Type.Literal('mine'), Type.Literal('idle')]),
  target: Type.Optional(Type.String()),
  state_version: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false });

```


* Initialize `Ajv` and compile the schema *outside* the request handler (on startup).
* Export `validateLLMIntent(json): Intent | null`.

### 4.2. Single-Flight LLM Client (`src/system1/llm_client.ts`)

* Implement `let inflight = false` to guarantee only one network request occurs at a time.
* Implement `THINK_INTERVAL = 250ms` (cooldown between requests).
* **Deadline Logic:**
```typescript
const deadline = performance.now() + 350;
const response = await fetch(LLM_URL, { ..., signal: AbortSignal.timeout(350) });
const json = await response.json();
if (performance.now() > deadline) return null; // Drop stale

```



### 4.3. Circuit Breaker (`src/system1/circuit_breaker.ts`)

* Implement states: `CLOSED` -> `OPEN` (after 3 consecutive fetch/parse failures) -> `HALF_OPEN` (probe after 5 seconds).
* If `OPEN`, System 1 returns `null` instantly, forcing System 0 to rely purely on `SafetyFSM` (Turtle Mode).

---

## 5. Phase 3: The Worker Boundary (Data Flattening)

**Goal:** Offload spatial grid analysis and A* pathfinding to avoid blocking the 20Hz tick.

### 5.1. Grid Extractor (`src/workers/grid_extractor.ts`)

* Write `extractLocalGrid(bot, radius=8): GridSnapshot`.
* Iterate through the local 16x16x16 volume using `bot.blockAt()`.
* Write primitive block IDs to a pre-allocated `Uint16Array(4096)`.
* **Must Not** allocate new arrays during iteration.

### 5.2. Worker Manager (`src/workers/worker_manager.ts`)

* Instantiate `new Worker('./pathfinder.worker.js')`.
* Pass the flattened data using zero-copy transfer:
```typescript
worker.postMessage({ blocks: blocks.buffer, ...meta }, [blocks.buffer]);

```



### 5.3. Worker Script (`src/workers/pathfinder.worker.ts`)

* Receive the `ArrayBuffer`, reconstruct the `Uint16Array`.
* Perform grid compression/stringification for the LLM context prompt here.
* Perform custom A* pathfinding. Return a simple array of `Vec3` primitives back to the main thread.

---

## 6. Phase 4: Telemetry & System 2 (Strategy)

### 6.1. Decoupled Telemetry

* Implement a `RingBuffer` in System 0 to store the last 10 ticks of state.
* Create a separate `setInterval` running at **5Hz (200ms)** that stringifies the buffer (`JSON.stringify` initially) and broadcasts via WebSocket.

### 6.2. System 2 (Pre-Frontal Cortex)

* A slow, 30-60 second async loop.
* Maintains long-term inventory goals (e.g., "Need Iron").
* Injects high-level directives into the System 1 prompt context (e.g., `Strategic Directive: Find a cave to mine iron`).

---

## Execution Instructions for AI Assistant

1. **Read all constraints thoroughly.** If you attempt to pass a Mineflayer `Block` to a worker thread or use Zod in the System 1 tick, the architecture fails.
2. Assume Node.js v22+ environment.
3. Start by scaffolding the project and implementing **Phase 1** (Core System 0 and `perf_hooks`).
4. **Pause and await user review** after completing each phase before proceeding to the next.

```

```