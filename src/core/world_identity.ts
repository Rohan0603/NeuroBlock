export type WorldIdentitySource = 'config' | 'locraw' | 'server-brand' | 'unknown';

export interface WorldIdentity {
  readonly server?: string;
  readonly gametype?: string;
  readonly lobbyName?: string;
  readonly map?: string;
  readonly source: WorldIdentitySource;
}

export function parseLocraw(rawText: string): WorldIdentity | undefined {
  if (!rawText.trimStart().startsWith('{')) return undefined;
  try {
    const value = JSON.parse(rawText) as Record<string, unknown>;
    if (typeof value.server !== 'string' || value.server.length === 0) return undefined;
    return {
      server: value.server,
      ...(typeof value.gametype === 'string' ? { gametype: value.gametype } : {}),
      ...(typeof value.lobbyname === 'string' ? { lobbyName: value.lobbyname } : {}),
      ...(typeof value.map === 'string' ? { map: value.map } : {}),
      source: 'locraw',
    };
  } catch {
    return undefined;
  }
}

export function configuredWorldIdentity(env: NodeJS.ProcessEnv = process.env): WorldIdentity {
  const server = env.WORLD_SERVER ?? 'local-paper';
  const gametype = env.WORLD_GAMETYPE ?? 'survival';
  const map = env.WORLD_MAP ?? 'world';
  return { server, gametype, map, source: 'config' };
}
