# Mindcraft Project Reference

This document records the Mindcraft architecture relevant to VoxelCortex:

- LLM integration.
- Mineflayer integration.
- Prompt and memory design.
- Command validation.
- Navigation, mining, collection, and placement.
- Action cancellation and recovery.
- Patterns that VoxelCortex may reuse.
- Patterns that VoxelCortex must not copy because they violate its execution
  firewall.

## Source

- Repository: <https://github.com/mindcraft-bots/mindcraft>
- Local clone used for analysis: `C:\Users\ponna\Project\mindcraft`
- Analyzed revision: `5f3acc87b479864124173de444f31fa5538f94a6`
- Analysis date: 2026-09-28

This is a derived engineering reference. It is not a vendored copy of
Mindcraft and does not make VoxelCortex depend on Mindcraft.

## 1. High-level architecture

Mindcraft uses one LLM agent with two execution modes:

```text
Player/system message
  -> conversation history
  -> prompt construction
  -> LLM response
  -> command or code extraction
  -> validation
  -> Mineflayer action
  -> result/error
  -> conversation history
  -> next LLM decision
```

Main agent:

- `src/agent/agent.js`

Important components:

- `src/agent/agent.js` — agent lifecycle and message loop.
- `src/agent/conversation.js` — bot-to-bot conversations.
- `src/agent/action_manager.js` — serialized action execution.
- `src/agent/coder.js` — generated-code mode.
- `src/models/prompter.js` — prompt expansion and provider calls.
- `src/models/*` — provider adapters.
- `src/agent/commands/index.js` — command registry, parser, and validation.
- `src/agent/commands/actions.js` — Mineflayer action commands.
- `src/agent/library/world.js` — world observation helpers.
- `src/agent/library/skills.js` — Mineflayer operation helpers.
- `src/agent/library/full_state.js` — bounded state projection.
- `src/agent/self_prompter.js` — autonomous goal loop.
- `src/agent/modes.js` — tick-driven survival behavior.
- `src/utils/mcdata.js` — Mineflayer creation and plugin loading.

## 2. LLM integration

### 2.1 Conversation mode

`Agent.handleMessage()` is the main LLM control loop.

Process:

1. Receive a user, system, or bot message.
2. Detect direct commands.
3. Translate message when required.
4. Append message to history.
5. Expand the configured prompt profile.
6. Send history and system prompt to the selected model.
7. Extract the first command marker from the response.
8. Truncate trailing text and commands.
9. Validate the command.
10. Execute the command.
11. Add the execution result or error to history.
12. Optionally request another response.

Source:

- `src/agent/agent.js`
- `src/models/prompter.js`

Example model output:

```text
!collectBlocks("oak_log", 5)
```

The model does not send Minecraft packets. It selects a registered operation.
The registered operation invokes Mineflayer code.

### 2.2 Direct user commands

Users can issue a registered command directly. Direct commands bypass the
normal conversational model response path.

Examples:

```text
!stop
!collectBlocks("oak_log", 5)
!goToCoordinates(10, 70, 20, 2)
!craftRecipe("wooden_hoe", 1)
!digDown(3)
```

`!newAction` is treated specially: its input is retained in history so the
coding model has context.

### 2.3 Generated-code mode

Mindcraft supports a second mode where the LLM generates JavaScript code.

The generated code receives:

- `bot`
- `skills`
- `world`
- `Vec3`

The code is:

1. Extracted from a fenced code block.
2. Checked by the coder/linter.
3. Executed in a SES compartment.
4. Given output and errors.
5. Retried up to five times.

Relevant files:

- `src/agent/coder.js`
- `src/agent/library/lockdown.js`
- `profiles/defaults/_default.json`

The generated-code prompt requires asynchronous Mineflayer calls to use
`await`. It also asks the model to write a code block instead of a command.

### 2.4 Generated-code safety limitation

Mindcraft's generated-code mode is not a suitable execution model for
VoxelCortex:

- Generated code receives the complete Mineflayer `bot`.
- Generated code can bypass a typed intent firewall.
- SES uses `unsafeEval` because a Mineflayer dependency requires evaluation.
- Generated code can create unbounded work.
- Generated code can invoke arbitrary Mineflayer mutation methods.

VoxelCortex must keep its existing boundary:

```text
Human goal
  -> System 2 strategy
  -> System 1 validated intent
  -> System 0 safety
  -> ExecutionKernel
  -> Mineflayer
```

Do not expose the complete Bot object to an LLM in VoxelCortex.

## 3. Prompt construction

Mindcraft keeps prompt text in profile JSON files. The prompter expands
placeholders before each provider request.

Main implementation:

- `src/models/prompter.js`

Important placeholders:

- `$NAME` — agent name.
- `$STATS` — stats, entities, and nearby blocks.
- `$INVENTORY` — inventory summary.
- `$ACTION` — current action label.
- `$COMMAND_DOCS` — dynamically generated commands.
- `$CODE_DOCS` — relevant skill documentation for code generation.
- `$EXAMPLES` — retrieved examples.
- `$MEMORY` — compressed long-term memory.
- `$TO_SUMMARIZE` — history selected for memory compression.
- `$CONVO` — recent conversation.
- `$SELF_PROMPT` — current autonomous goal.
- `$LAST_GOALS` — previous goal outcomes.

Relevant profiles:

- `profiles/defaults/_default.json`
- `profiles/defaults/survival.json`
- `profiles/andy-4-reasoning.json`

The profile tells the model:

- what persona to use;
- what commands exist;
- how short responses should be;
- whether to use commands or code;
- what world context to inspect;
- how to behave during self-prompting.

### 3.1 Dynamic command documentation

`$COMMAND_DOCS` is generated from the live command registry. It includes
command names, descriptions, and parameter definitions while excluding
blacklisted actions.

This avoids maintaining a separate prompt-only command list.

VoxelCortex equivalent:

- `src/core/capabilities.ts`

Recommended extension:

- derive prompt descriptions from the capability registry;
- include target shape;
- include preconditions;
- include failure codes;
- include recovery behavior.

## 4. Provider abstraction

Provider adapters implement a common request shape:

```js
sendRequest(turns, systemMessage, stopSequence)
```

Provider files include:

- `src/models/gpt.js`
- `src/models/claude.js`
- `src/models/gemini.js`
- `src/models/groq.js`
- `src/models/mistral.js`
- `src/models/deepseek.js`
- `src/models/cerebras.js`
- `src/models/ollama.js`
- `src/models/openrouter.js`
- `src/models/replicate.js`
- `src/models/vllm.js`
- `src/models/lmstudio.js`

The OpenAI adapter supports:

- Responses API;
- Chat Completions for custom OpenAI-compatible URLs;
- stop sequences;
- model parameters;
- context-length retry;
- fallback text after provider errors.

Context overflow handling removes older turns and retries:

```text
full history
  -> context error
  -> remove oldest turns
  -> retry
```

VoxelCortex can reuse this provider-layer responsibility. Context reduction
should not be implemented inside System 0.

## 5. Command registry and validation

### 5.1 Registry

Command definitions contain:

- command name;
- description;
- parameter names;
- parameter types;
- numeric domains;
- implementation function.

Files:

- `src/agent/commands/index.js`
- `src/agent/commands/actions.js`
- `src/agent/commands/queries.js`

### 5.2 Parser

The parser accepts a narrow scalar syntax:

- integers;
- floating-point values;
- booleans;
- quoted strings.

It does not accept arbitrary nested JSON objects.

### 5.3 Validation

Validation checks:

- command exists;
- command is not blacklisted;
- argument count matches;
- argument type matches;
- numeric values are inside declared ranges;
- block names exist;
- item names exist.

Only validated commands reach their implementation.

VoxelCortex improves this with TypeBox/Ajv and discriminated target objects.
That approach should remain the source of truth for NeuroBlock.

## 6. Mineflayer initialization

Implementation:

- `src/utils/mcdata.js`

Mineflayer is created from configured:

- username;
- host;
- port;
- authentication mode;
- Minecraft version.

Plugins loaded:

- `mineflayer-pathfinder`;
- `mineflayer-pvp`;
- `mineflayer-collectblock`;
- `mineflayer-auto-eat`;
- `mineflayer-armor-manager`.

Mindcraft also initializes:

- Minecraft data;
- item data;
- resource-pack handling;
- login events;
- connection timeout behavior;
- position packet throttling.

VoxelCortex already uses the important navigation and collection plugins.

## 7. Mineflayer world observation

### 7.1 Direct block observation

Mindcraft uses:

```js
bot.blockAt(position)
```

for:

- block below feet;
- legs;
- head;
- blocks above head;
- exact mining targets;
- placement references;
- safety checks.

### 7.2 Nearby blocks

Mindcraft uses:

```js
bot.findBlocks({
    matching: predicate,
    maxDistance: distance,
    count
})
```

The helper then maps positions to blocks with `bot.blockAt`.

Examples:

- nearest resource;
- nearest free space;
- nearby water;
- nearby furnace;
- nearby crafting table;
- safe placement position.

### 7.3 Entities

Mindcraft uses:

- `bot.entities`;
- `bot.nearestEntity`;
- entity position distance;
- hostile entity filtering.

The LLM receives entity types and distances instead of raw entity objects.

### 7.4 Inventory

Mindcraft uses:

- `bot.inventory.items()`;
- `bot.inventory.slots`;
- `bot.heldItem`;
- `bot.equip`;
- `bot.tool.equipForBlock`.

Inventory summaries are inserted into prompts only when the profile requests
`$INVENTORY`.

## 8. Mineflayer movement and navigation

### 8.1 Pathfinder

Mindcraft uses native Pathfinder:

```js
bot.pathfinder.getPathTo(...)
bot.pathfinder.setMovements(...)
bot.pathfinder.goto(...)
```

`goToGoal()` builds:

1. Non-destructive movements.
2. Destructive movements.
3. A final selected movement configuration.

It assigns costs to:

- digging;
- placing;
- breaking glass;
- opening doors.

It uses a one-second path calculation timeout.

### 8.2 Goal types

Mindcraft uses:

- `GoalNear`;
- `GoalFollow`;
- `GoalInvert`;

Examples:

- move near coordinates;
- follow a player;
- move toward a resource;
- move away from a threat;
- collect dropped items.

### 8.3 Direct control

Some survival modes use:

```js
bot.setControlState('jump', true)
bot.setControlState('forward', true)
bot.clearControlStates()
```

These operations are directly available to Mindcraft modes.

VoxelCortex must keep direct control-state mutation inside System 0.

## 9. Mining

### 9.1 Exact block mining

Mindcraft's `breakBlockAt()` follows this sequence:

1. Validate coordinates.
2. Resolve target using `bot.blockAt`.
3. Skip air, water, and lava.
4. Move within reach if needed.
5. Equip a suitable tool with `bot.tool.equipForBlock`.
6. Check `block.canHarvest(itemId)`.
7. Dig with:

```js
await bot.dig(block, true);
```

The `true` argument forces the bot to look at the target.

VoxelCortex now follows the same pattern:

```text
System 1 mine intent
  -> bot.findBlock resolves nearby solid block
  -> target includes x/y/z/type
  -> System 0 checks bot.canDigBlock
  -> System 0 bot.lookAt(target, true)
  -> System 0 bot.dig(block)
```

### 9.2 Digging down

Mindcraft provides `!digDown(distance)`.

The implementation checks:

- water;
- lava;
- dangerous fall distance;
- block validity;
- interruptions;
- tool availability.

This is a useful reference for future VoxelCortex pit recovery, but must be
implemented as a validated System 0 capability rather than generated code.

### 9.3 Tool choice

Mindcraft equips a suitable tool before mining:

```js
await bot.tool.equipForBlock(block);
```

VoxelCortex currently validates `bot.canDigBlock` but does not yet perform
automatic tool selection for every manual mine intent.

## 10. Resource collection

Mindcraft uses `mineflayer-collectblock` for ordinary resource collection:

```js
await bot.collectBlock.collect(block);
```

Before collection it:

- finds a matching block;
- excludes forbidden positions;
- checks safe-to-break rules;
- checks harvestability;
- equips a tool;
- collects;
- optionally gathers dropped items;
- places light when needed.

Some blocks require manual handling:

- wheat;
- carrots;
- potatoes;
- beetroots;
- sugar cane;
- torches;
- buttons;
- levers;
- redstone;
- several plant types.

For these, Mindcraft moves near the block, calls `bot.dig`, and collects
nearby item entities.

## 11. Placement and crafting

### 11.1 Placement

`placeBlock()`:

1. Resolves a nearby free position.
2. Selects a reference block.
3. Equips the requested item.
4. Calls `bot.placeBlock`.
5. Optionally verifies the result.

It also supports placing temporary crafting tables and furnaces.

### 11.2 Crafting

Mindcraft uses:

```js
bot.recipesFor(...)
bot.craft(...)
```

It:

- checks recipes;
- checks inventory requirements;
- searches for crafting tables;
- places a table when configured and possible;
- crafts;
- collects temporary tables afterward;
- equips crafted armor.

VoxelCortex already uses native recipes through its System 0 crafting path.

## 12. Action lifecycle

Implementation:

- `src/agent/action_manager.js`

Only one long-running action is active at a time.

When a new action starts:

1. Stop the previous action.
2. Request interruption.
3. Wait for completion.
4. Clear bot logs.
5. Start new action.
6. Set timeout.
7. Capture output.
8. Emit Mineflayer `idle`.

Stop cleanup includes:

```js
bot.stopDigging();
bot.collectBlock.cancelTask();
bot.pathfinder.stop();
bot.pvp.stop();
bot.clearControlStates();
```

### 12.1 Timeouts

Long-running operations have minute-level timeouts. Timeout handling tries to
stop the action and records the timeout in history.

### 12.2 Fast-loop detection

Mindcraft tracks repeated actions:

- more than three very-fast repetitions cancels resume;
- more than five triggers process shutdown.

This prevents a failed command from spinning indefinitely.

### 12.3 Result feedback

Action results contain:

- success;
- output message;
- interrupted state;
- timed-out state.

Errors are returned to the LLM through history so the next response can repair
the action.

Recommended VoxelCortex improvement:

```ts
{
  ok: false,
  action: 'mine',
  errorCode: 'OUT_OF_REACH',
  observation: {
    position: { x, y, z },
    target: { x, y, z },
    block: 'stone'
  }
}
```

## 13. Survival modes

Implementation:

- `src/agent/modes.js`

Modes execute every tick and can interrupt normal actions.

Relevant modes:

- `self_preservation`;
- `unstuck`;
- `cowardice`;
- `self_defense`;
- `hunting`;
- `item_collecting`;
- `torch_placing`;
- `elbow_room`.

### 13.1 Self-preservation

Detects:

- water above the bot;
- fire;
- lava;
- falling blocks;
- critical damage.

Possible responses:

- jump;
- move away;
- place water;
- find nearby water;
- clear controls.

### 13.2 Unstuck

Tracks:

- previous position;
- current position;
- elapsed stuck time;
- current dig target;
- distance moved.

After a threshold:

1. Interrupt current action.
2. Move away.
3. Emit recovery text.
4. Kill the process if recovery does not complete within a crash timeout.

VoxelCortex uses a safer bounded recovery model:

- detect embedded feet/head;
- search safe stands;
- pass primitive terrain to System 1;
- let System 0 execute jump or mine;
- pause after repeated failure.

## 14. Autonomous self-prompting

Implementation:

- `src/agent/self_prompter.js`

Self-prompting sends internal messages requiring a command:

```text
Your next response MUST contain a command.
```

Behavior:

- loops until stopped;
- waits between actions;
- pauses during player conversations;
- stops after three no-command responses;
- restarts after idle time when active;
- supports explicit stop and pause.

VoxelCortex should only adopt this with:

- explicit goal state;
- cancellation;
- action deadline;
- provider budget;
- retry limit;
- memory limit;
- safety pause.

## 15. Conversation and multiple bots

Implementation:

- `src/agent/conversation.js`

Mindcraft supports bot-to-bot conversations:

- conversation activation;
- queued messages;
- response scheduling;
- connection monitoring;
- conversation timeout;
- self-prompt pause during conversation;
- history storage.

The receiving bot can decide whether to respond or ignore a message using a
dedicated prompt.

VoxelCortex does not currently need this feature for its single-bot control
boundary.

## 16. Memory and history

Implementation:

- `src/agent/history.js`
- `src/agent/memory_bank.js`

Mindcraft keeps:

- recent turns in memory;
- a compressed natural-language memory;
- complete history on disk;
- named coordinates in a small memory bank.

When the turn limit is reached:

1. Old turns are removed.
2. A dedicated memory prompt summarizes them.
3. Summary is capped.
4. Full history is persisted for audit.

The memory prompt excludes transient:

- stats;
- inventory;
- command documentation.

This separation is correct because those values should be refreshed from the
world instead of remembered.

Useful VoxelCortex memory candidates:

- named farm position;
- last safe position;
- last safe stand;
- failed goal coordinates;
- resource locations;
- completed construction steps;
- provider failure summary.

## 17. Vision

Mindcraft supports screenshot interpretation through:

- `src/agent/vision/browser_viewer.js`
- `src/agent/vision/vision_interpreter.js`

The LLM receives an image through a vision-capable provider adapter.

It can:

- look at a player;
- look at coordinates;
- summarize terrain;
- identify visible entities;
- report visible structures.

VoxelCortex currently relies on structured terrain observation. Vision can be
added later at System 2 only. It must not enter the 20Hz System 0 path.

## 18. Provider and execution safety comparison

### Mindcraft

- command blacklist;
- scalar parameter validation;
- action timeout;
- action interruption;
- fast-loop detection;
- generated-code linting;
- SES compartment;
- self-preservation modes.

### VoxelCortex

- TypeBox/Ajv intent validation;
- capability registry;
- state-version checks;
- System 0 safety FSM;
- System 0-only Mineflayer mutation;
- 20Hz synchronous safety tick;
- single-flight Pathfinder goal;
- embedded-block recovery;
- bounded jump pulse;
- loopback-only control API;
- primitive worker/provider data.

VoxelCortex has the stronger mutation boundary. Mindcraft has a more mature
general-purpose action lifecycle and error-repair loop.

## 19. Patterns worth adopting in VoxelCortex

### Adopt

1. Generate LLM-visible capability docs from `CAPABILITIES`.
2. Include exact target schema in capability descriptions.
3. Return structured action results.
4. Feed failures into the next System 1 observation.
5. Keep one active action per operation type.
6. Add explicit cancellation results.
7. Add tool selection before manual mining.
8. Preserve exact block coordinates for dig targets.
9. Add named-location memory.
10. Add provider context reduction.
11. Add bounded retry repair for failed multi-step goals.
12. Keep world snapshots primitive and size-limited.

### Do not adopt

1. Full Bot exposure to an LLM.
2. Generated JavaScript as a bypass around System 0.
3. Direct LLM calls to Mineflayer mutation methods.
4. Unbounded self-prompting.
5. Global mutable command blacklists.
6. Text-only error feedback.
7. Unbounded Pathfinder retries.

## 20. Recommended VoxelCortex mapping

| Mindcraft pattern | VoxelCortex location |
|---|---|
| Command registry | `src/core/capabilities.ts` |
| Command validation | `src/system1/firewall.ts` |
| Action executor | `src/system0/execution_kernel.ts` |
| Action cancellation | `ExecutionKernel.resetToIdle()` |
| World projection | `AgentRuntime.observe()` |
| World helpers | `AgentRuntime` native Mineflayer helpers |
| Strategic prompt | `src/system2/opencode_client.ts` |
| Fast decision prompt | `src/system1/jev_client.ts` |
| Provider abstraction | System 1/System 2 clients |
| Action result telemetry | `src/core/telemetry.ts` |
| Long-term task memory | Future bounded runtime state |

## 21. Current VoxelCortex relevance

The most useful Mindcraft pattern for the current pit problem is exact-target
native mining:

```text
find exact block
  -> check distance and dig capability
  -> look at target
  -> equip suitable tool
  -> dig exact block
  -> return result
```

VoxelCortex now implements the safe subset:

```text
System 1 selects mine
  -> runtime uses bot.findBlock
  -> intent contains block type and coordinates
  -> System 0 checks bot.canDigBlock
  -> System 0 calls bot.lookAt
  -> System 0 calls bot.dig
```

## 22. Reference limitations

This document summarizes the parts of Mindcraft relevant to VoxelCortex. It
does not reproduce every action implementation, every provider adapter, or
every profile example.

Mindcraft is an active external project. Re-check the source revision before
using this document for a new implementation.

