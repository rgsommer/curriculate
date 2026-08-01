/**
 * Anthropic client over plain fetch — deliberately no SDK dependency, so this drops into the
 * existing frontend/ package without adding anything to package.json.
 */
export const SCAN_MODEL = process.env.OPP_SCAN_MODEL || 'claude-sonnet-4-5';
export const REPORT_MODEL = process.env.OPP_REPORT_MODEL || 'claude-opus-4-6';
const WEB_SEARCH_ON = (process.env.OPP_ENABLE_WEB_SEARCH ?? 'true') !== 'false';
const API = 'https://api.anthropic.com/v1/messages';

type Block = Record<string, any>;
type Msg = { role: 'user' | 'assistant'; content: string | Block[] };

async function call(body: Record<string, unknown>) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 500)}`);
  return res.json();
}

/** Runs a prompt and forces a structured JSON answer via a single tool definition. */
export async function structured<T>(opts: {
  model: string;
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  toolName?: string;
  maxTokens?: number;
  maxSearches?: number;
}): Promise<{ data: T; usage: { input: number; output: number }; searches: number }> {
  const toolName = opts.toolName || 'emit_result';
  const tools: Block[] = [
    {
      name: toolName,
      description: 'Return the finished analysis. Call this exactly once, at the very end.',
      input_schema: opts.schema,
    },
  ];
  if (WEB_SEARCH_ON && (opts.maxSearches ?? 0) > 0) {
    tools.unshift({ type: 'web_search_20250305', name: 'web_search', max_uses: opts.maxSearches });
  }

  const messages: Msg[] = [{ role: 'user', content: opts.prompt }];
  const usage = { input: 0, output: 0 };
  let searches = 0;

  for (let turn = 0; turn < 24; turn++) {
    const res = await call({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 16000,
      system: opts.system,
      tools,
      messages,
    });
    usage.input += res.usage?.input_tokens ?? 0;
    usage.output += res.usage?.output_tokens ?? 0;
    const content: Block[] = res.content ?? [];
    searches += content.filter((b) => b.type === 'server_tool_use').length;

    const emit = content.find((b) => b.type === 'tool_use' && b.name === toolName);
    if (emit) return { data: emit.input as T, usage, searches };

    messages.push({ role: 'assistant', content });

    const clientToolUses = content.filter((b) => b.type === 'tool_use' && b.name !== toolName);
    if (clientToolUses.length > 0) {
      messages.push({
        role: 'user',
        content: clientToolUses.map((b) => ({
          type: 'tool_result',
          tool_use_id: b.id,
          content: 'Not available. Proceed with what you have.',
        })),
      });
    } else {
      messages.push({
        role: 'user',
        content: `Call the \`${toolName}\` tool now with the complete result. Do not reply with prose.`,
      });
    }
  }
  throw new Error('Model did not produce a structured result within the turn limit.');
}

/** Rough cost model for the internal margin readout. Update when list prices change. */
const PRICE_PER_MTOK: Record<string, { in: number; out: number }> = {
  'claude-opus-4-6': { in: 5, out: 25 },
  'claude-sonnet-4-5': { in: 3, out: 15 },
  'claude-haiku-4-5': { in: 1, out: 5 },
};
export function estimateCostUsd(model: string, u: { input: number; output: number }) {
  const p = PRICE_PER_MTOK[model] ?? PRICE_PER_MTOK['claude-sonnet-4-5'];
  return (u.input / 1e6) * p.in + (u.output / 1e6) * p.out;
}
