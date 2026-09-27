import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AgentStatus } from '../core/types.js';
import { GoalStore } from '../core/goal_store.js';

export interface ControlServerOptions {
  readonly host?: string;
  readonly port?: number;
  readonly status: () => AgentStatus;
  readonly goals: GoalStore;
  readonly pause: () => void;
  readonly resume: () => void;
  readonly emergencyStop: () => void;
  readonly telemetry?: () => Promise<unknown>;
}

async function readBody(request: IncomingMessage): Promise<string> {
  let body = '';
  for await (const chunk of request) {
    body += chunk.toString();
    if (body.length > 2048) throw new Error('Request body is too large');
  }
  return body;
}

function json(response: ServerResponse, status: number, value: unknown): void {
  const payload = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  response.end(payload);
}

export class ControlServer {
  private server: Server | undefined;
  public constructor(private readonly options: ControlServerOptions) {}

  public async start(): Promise<void> {
    if (this.server) return;
    this.server = createServer(async (request, response) => {
      try {
        if (request.method === 'GET' && request.url === '/status') {
          json(response, 200, this.options.status());
          return;
        }
        if (request.method === 'GET' && request.url === '/telemetry') {
          json(response, 200, this.options.telemetry ? await this.options.telemetry() : { error: 'Telemetry unavailable' });
          return;
        }
        if (request.method === 'POST' && request.url === '/goal') {
          const body = JSON.parse(await readBody(request)) as { goal?: unknown };
          if (typeof body.goal !== 'string') throw new Error('Body must contain a string goal');
          json(response, 200, this.options.goals.set(body.goal));
          return;
        }
        if (request.method === 'DELETE' && request.url === '/goal') {
          this.options.goals.clear();
          json(response, 200, { ok: true });
          return;
        }
        if (request.method === 'POST' && request.url === '/pause') { this.options.pause(); json(response, 200, { ok: true }); return; }
        if (request.method === 'POST' && request.url === '/resume') { this.options.resume(); json(response, 200, { ok: true }); return; }
        if (request.method === 'POST' && request.url === '/emergency-stop') { this.options.emergencyStop(); json(response, 200, { ok: true }); return; }
        json(response, 404, { error: 'Not found' });
      } catch (error) {
        json(response, 400, { error: error instanceof Error ? error.message : 'Invalid request' });
      }
    });
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.options.port ?? 8787, this.options.host ?? '127.0.0.1', () => resolve());
    });
  }

  public async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}
