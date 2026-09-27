export type Action = 'move' | 'jump' | 'attack' | 'mine' | 'collect' | 'eat' | 'craft' | 'place' | 'flee' | 'drop' | 'equip' | 'sleep' | 'activate' | 'idle';

export type EquipmentDestination = 'hand' | 'off-hand' | 'head' | 'torso' | 'legs' | 'feet';
export type IntentTarget =
  | { readonly kind: 'near'; readonly x: number; readonly y: number; readonly z: number; readonly range?: number }
  | { readonly kind: 'entity'; readonly id: number }
  | { readonly kind: 'block'; readonly type: number }
  | { readonly kind: 'collect'; readonly names: readonly string[]; readonly maxDistance: number }
  | { readonly kind: 'item'; readonly name: string }
  | { readonly kind: 'craft'; readonly item: string }
  | { readonly kind: 'equip'; readonly item: string; readonly destination: EquipmentDestination }
  | { readonly kind: 'activate'; readonly x: number; readonly y: number; readonly z: number }
  | { readonly kind: 'place'; readonly block: string; readonly reference: { readonly x: number; readonly y: number; readonly z: number }; readonly face: { readonly x: number; readonly y: number; readonly z: number } };

export interface Intent {
  readonly action: Action;
  readonly target?: IntentTarget;
  readonly state_version: number;
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
  readonly createdAt: number;
  readonly relevantCapabilities?: readonly Action[];
}

export type StrategicObjectiveKind = 'explore' | 'collect' | 'build' | 'farm' | 'survive' | 'combat' | 'shelter';

export interface StrategicObjective {
  readonly kind: StrategicObjectiveKind;
  readonly text: string;
  readonly constraints: readonly string[];
}

export interface AgentGoal {
  readonly text: string;
  readonly version: number;
  readonly createdAt: number;
}

export interface AgentStatus {
  readonly connected: boolean;
  readonly paused: boolean;
  readonly emergencyStopped: boolean;
  readonly goal?: AgentGoal;
  readonly directive?: StrategicDirective;
  readonly lastAction?: Action;
  readonly stateVersion: number;
  readonly lastError?: string;
  readonly decisionCount: number;
  readonly telemetryEvents: number;
  readonly telemetryMalformedRecords?: number;
  readonly telemetryWriteError?: string;
  readonly navigation?: NavigationStatus;
}

export interface NavigationStatus {
  readonly state: 'idle' | 'planning' | 'moving' | 'stalled';
  readonly goal?: { readonly x: number; readonly y: number; readonly z: number };
  readonly lastPathStatus?: 'success' | 'partial' | 'timeout' | 'noPath';
  readonly recoveryCount: number;
  readonly lastFault?: string;
}
