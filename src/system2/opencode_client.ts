export interface OpenCodeZenClientOptions {
  readonly endpoint?: string;
  readonly apiKey?: string;
  readonly model?: string;
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
}

interface ResponsesApiPayload {
  readonly output?: readonly { readonly content?: readonly { readonly text?: unknown }[] }[];
  readonly choices?: readonly { readonly message?: { readonly content?: unknown } }[];
}

function extractText(payload: ResponsesApiPayload): string {
  const responseText = payload.output?.flatMap((item) => item.content ?? [])
    .map((part) => typeof part.text === 'string' ? part.text : '').filter(Boolean).join('\n');
  if (responseText) return responseText.trim();
  return payload.choices?.map((choice) => typeof choice.message?.content === 'string' ? choice.message.content : '')
    .filter(Boolean).join('\n').trim() ?? '';
}

export class OpenCodeZenClient {
  private readonly endpoint: string;
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  public constructor(options: OpenCodeZenClientOptions = {}) {
    this.endpoint = options.endpoint ?? process.env.OPENCODE_API_URL ?? 'https://opencode.ai/zen/v1/responses';
    this.apiKey = options.apiKey ?? process.env.OPENCODE_API_KEY;
    this.model = options.model ?? process.env.OPENCODE_MODEL ?? 'gpt-5.5';
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  public async requestDirective(state: string): Promise<string | null> {
    if (!this.apiKey) throw new Error('OPENCODE_API_KEY is required for OpenCode Zen');
    const response = await this.fetcher(this.endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(this.endpoint.endsWith('/chat/completions')
        ? { model: this.model, messages: [
          { role: 'system', content: 'Return one concise strategic directive for the Minecraft agent. Do not execute tools.' },
          { role: 'user', content: state },
        ], max_tokens: 160 }
        : { model: this.model, input: [
          { role: 'system', content: 'Return one concise strategic directive for the Minecraft agent. Do not execute tools.' },
          { role: 'user', content: state },
        ], max_output_tokens: 160 }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      const detail = (await response.text()).replace(/\s+/g, ' ').slice(0, 500);
      throw new Error(`OpenCode Zen request failed with status ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    return extractText(await response.json() as ResponsesApiPayload) || null;
  }
}
