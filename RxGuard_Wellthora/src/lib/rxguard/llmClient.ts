import 'server-only';

export type ChatRole = 'system' | 'user' | 'assistant';

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export interface OpenAiCompatChatOptions {
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  apiKey?: string;
  timeoutMs?: number;
}

export type LlmProvider = 'openai_compat' | 'ollama';

async function chatOllama(opts: OpenAiCompatChatOptions): Promise<string> {
  const url = new URL('/api/chat', opts.baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);

  try {
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        stream: false,
        options: {
          temperature: opts.temperature ?? 0.2,
          num_predict: opts.maxTokens ?? 512,
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ollama HTTP ${res.status}: ${text.slice(0, 300)}`);
    }

    const json = (await res.json()) as any;
    const content = json?.message?.content ?? json?.response;
    if (typeof content !== 'string') {
      throw new Error('Ollama response missing message.content');
    }
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Unified chat API.
 *
 * Supported providers:
 * - openai_compat: POST /v1/chat/completions (vLLM, TGI OpenAI mode, some Ollama builds)
 * - ollama: POST /api/chat (native Ollama)
 */
export async function chatCompletion(
  opts: OpenAiCompatChatOptions & { provider?: LlmProvider }
): Promise<string> {
  const provider =
    opts.provider ??
    (process.env.RXGUARD_LLM_PROVIDER as LlmProvider | undefined) ??
    'openai_compat';

  if (provider === 'ollama') {
    return chatOllama(opts);
  }
  return chatOpenAiCompatible(opts);
}

export async function chatOpenAiCompatible(opts: OpenAiCompatChatOptions): Promise<string> {
  const url = new URL('/v1/chat/completions', opts.baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);

  try {
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 512,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 300)}`);
    }

    const json = (await res.json()) as any;
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('LLM response missing choices[0].message.content');
    }
    return content;
  } finally {
    clearTimeout(timeout);
  }
}
