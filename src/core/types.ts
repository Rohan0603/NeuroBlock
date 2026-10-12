export type Action = 'move' | 'jump' | 'attack' | 'mine' | 'collect' | 'eat' | 'craft' | 'place' | 'flee' | 'drop' | 'equip' | 'sleep' | 'activate' | 'idle';
import type { WorldIdentity } from './world_identity.js';

export type EquipmentDestination = 'hand' | 'off-hand' | 'head' | 'torso' | 'legs' | 'feet';
export type Direction = 'north' | 'south' | 'east' | 'west';
export interface TargetHint { readonly kind: 'direction'; readonly direction: Direction; readonly distance: number; }
export type IntentTarget =
  | { readonly kind: 'near'; readonly x: number; readonly y: number; readonly z: number; readonly range?: number }
  | { readonly kind: 'entity'; readonly id: number }
  | { readonly kind: 'block'; readonly type: number; readonly x?: number; readonly y?: number; readonly z?: number }
  | { readonly kind: 'collect'; readonly names: readonly string[]; readonly maxDistance: number }
  | { readonly kind: 'item'; readonly name: string }
  | { readonly kind: 'craft'; readonly item: string }
  | { readonly kind: 'equip'; readonly item: string; readonly destination: EquipmentDestination }
  | { readonly kind: 'activate'; readonly x: number; readonly y: number; readonly z: number }
  | { readonly kind: 'place'; readonly block: string; readonly reference: { readonly x: number; readonly y: number; readonly z: number }; readonly face: { readonly x: number; readonly y: number; readonly z: number } };

export interface Intent {
  readonly action: Action;
  readonly target?: IntentTarget;
  readonly targetHint?: TargetHint;
  readonly candidateId?: string;
  readonly state_version: number;
}

export interface ActionResult {
  readonly action: Action;
  readonly ok: boolean;
  readonly errorCode?: string;
  readonly message?: string;
  readonly retryable?: boolean;
  readonly target?: IntentTarget;
  readonly completedAt: number;
}

export interface IntentEpoch {
  readonly stateVersion: number;
  readonly requestId: number;
  readonly intent: Intent;
}

export interface TickState {
  readonly stateVersion: number;
  readonly health: number;
  readonly danger: boolean;
}

export interface StrategicDirective {
  readonly text: string;
  readonly objective: StrategicObjective;
  readonly plan?: TaskPlan;
  readonly createdAt: number;
  readonly relevantCapabilities?: readonly Action[];
}

export interface TaskPlan {
  readonly objective: 'escape' | 'navigate' | 'gather' | 'craft' | 'build';
  readonly steps: readonly { readonly step: TaskStep; readonly purpose: string }[];
}

export type StrategicObjectiveKind = 'explore' | 'collect' | 'build' | 'farm' | 'survive' | 'combat' | 'shelter';

export interface StrategicObjective {
  readonly kind: StrategicObjectiveKind;
  readonly text: string;
  readonly constraints: readonly string[];
  readonly steps?: readonly string[];
}

export interface AgentGoal {
  readonly text: string;
  readonly version: number;
  readonly createdAt: number;
}

export type TaskStep = 'escape' | 'navigate' | 'gather' | 'craft' | 'build' | 'verify' | 'complete' | 'failed';
export type TaskStatus = 'active' | 'complete' | 'failed';

export interface TaskState {
  readonly goal: string;
  readonly goalVersion: number;
  readonly step: TaskStep;
  readonly status: TaskStatus;
  readonly attempts: number;
  readonly startedAt: number;
  readonly deadlineAt: number;
  readonly stableSince?: number;
  readonly completedAt?: number;
  readonly failure?: string;
}

export interface GoalCheckpoint {
  readonly name: string;
  readonly completed: boolean;
}

export interface NamedLocation {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface AgentStatus {
  readonly connected: boolean;
  readonly paused: boolean;
  readonly emergencyStopped: boolean;
  readonly goal?: AgentGoal;
  readonly task?: TaskState;
  readonly directive?: StrategicDirective;
  readonly lastAction?: Action;
  readonly lastExecution?: ActionResult;
  readonly checkpoint?: GoalCheckpoint;
  readonly locations?: readonly NamedLocation[];
  readonly stateVersion: number;
  readonly lastError?: string;
  readonly decisionCount: number;
  readonly telemetryEvents: number;
  readonly telemetryMalformedRecords?: number;
  readonly telemetryWriteError?: string;
  readonly navigation?: NavigationStatus;
  readonly worldIdentity?: WorldIdentity;
  readonly position?: { readonly x: number; readonly y: number; readonly z: number };
  readonly world?: {
    readonly safeOpenGround: boolean;
    readonly onGround: boolean;
    readonly supportBlock?: string;
    readonly feetBlock?: string;
    readonly headBlock?: string;
    readonly blockedAbove?: number;
    readonly blockedAboveAt?: readonly number[];
  };
  readonly jev?: JevMetrics;
  readonly home?: HomeStatus;
}

export interface HomeStatus {
  readonly anchor: { readonly x: number; readonly y: number; readonly z: number };
  readonly requiredBlocks: number;
  readonly placedBlocks: number;
  readonly complete: boolean;
}

export interface JevMetrics {
  readonly used: number;
  readonly timeout: number;
  readonly lowConfidence: number;
  readonly actionChanged: number;
  readonly actionApplied: number;
}

export interface NavigationStatus {
  readonly state: 'idle' | 'planning' | 'moving' | 'stalled';
  readonly goal?: { readonly x: number; readonly y: number; readonly z: number };
  readonly lastPathStatus?: 'success' | 'partial' | 'timeout' | 'noPath';
  readonly recoveryCount: number;
  readonly lastFault?: string;
}
