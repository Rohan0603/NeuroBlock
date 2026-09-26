export type Action = 'move' | 'attack' | 'mine' | 'eat' | 'craft' | 'idle';

export interface Intent {
  readonly action: Action;
  readonly target?: string;
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
  readonly createdAt: number;
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
  readonly pathLength: number;
}

export interface GridSnapshot {
  readonly blocks: Uint16Array;
  readonly origin: { readonly x: number; readonly y: number; readonly z: number };
  readonly size: number;
}
