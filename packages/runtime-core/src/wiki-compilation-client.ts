import { redactText } from '@popeye/observability';

export interface WikiCompileInput {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
}

export interface WikiCompileOutput {
  markdown: string;
  suggestedEntities: string[];
  suggestedCrossLinks: string[];
  summary: string;
}

export interface WikiCompilationClient {
  compile(input: WikiCompileInput): Promise<WikiCompileOutput>;
  readonly enabled: boolean;
}

/**
 * Parse the LLM JSON response into a WikiCompileOutput.
 * Handles both clean JSON and markdown-fenced JSON blocks.
 */
function parseCompileResponse(raw: string): WikiCompileOutput {
  let cleaned = raw.trim();
  // Strip markdown code fence if present
  const fenceMatch = cleaned.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  if (fenceMatch) {
    cleaned = fenceMatch[1]!.trim();
  }

  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    return {
      markdown: typeof parsed['markdown'] === 'string' ? parsed['markdown'] : '',
      suggestedEntities: Array.isArray(parsed['suggestedEntities'])
        ? (parsed['suggestedEntities'] as unknown[]).filter((e): e is string => typeof e === 'string')
        : [],
      suggestedCrossLinks: Array.isArray(parsed['suggestedCrossLinks'])
        ? (parsed['suggestedCrossLinks'] as unknown[]).filter((e): e is string => typeof e === 'string')
        : [],
      summary: typeof parsed['summary'] === 'string' ? parsed['summary'] : '',
    };
  } catch {
    // If JSON parsing fails, treat the entire response as markdown
    return {
      markdown: raw.trim(),
      suggestedEntities: [],
      suggestedCrossLinks: [],
      summary: '',
    };
  }
}

export function createOpenAIWikiCompilationClient(config: {
  model: string;
  timeoutMs?: number;
}): WikiCompilationClient {
  const model = config.model;
  const timeoutMs = config.timeoutMs ?? 60_000;

  return {
    enabled: true,

    async compile(input: WikiCompileInput): Promise<WikiCompileOutput> {
      const apiKey = process.env['OPENAI_API_KEY'];
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY environment variable is not set');
      }

      const { text: redactedUser } = redactText(input.userPrompt);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: input.systemPrompt },
              { role: 'user', content: redactedUser },
            ],
            max_tokens: input.maxTokens,
            temperature: 0.4,
            response_format: { type: 'json_object' },
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`OpenAI completions API error (${response.status}): ${body}`);
        }

        const json = (await response.json()) as {
          choices: Array<{ message: { content: string } }>;
        };

        const raw = json.choices[0]?.message?.content ?? '';
        return parseCompileResponse(raw);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function createDisabledWikiCompilationClient(): WikiCompilationClient {
  return {
    enabled: false,

    async compile(_input: WikiCompileInput): Promise<WikiCompileOutput> {
      // When disabled, return the user prompt content as-is (template fallback).
      // The caller is responsible for providing template-generated markdown in the prompt.
      return {
        markdown: '',
        suggestedEntities: [],
        suggestedCrossLinks: [],
        summary: '',
      };
    },
  };
}
