import { redactText } from '@popeye/observability';

export interface SummarizationClient {
  complete(input: { systemPrompt: string; userPrompt: string; maxTokens: number }): Promise<string>;
  readonly enabled: boolean;
}

export function createOpenAISummarizationClient(config: {
  model?: string;
  timeoutMs?: number;
}): SummarizationClient {
  const model = config.model ?? 'gpt-4o-mini';
  const timeoutMs = config.timeoutMs ?? 30_000;

  return {
    enabled: true,

    async complete(input: { systemPrompt: string; userPrompt: string; maxTokens: number }): Promise<string> {
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
            temperature: 0.3,
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

        return json.choices[0]?.message?.content ?? '';
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function createDisabledSummarizationClient(): SummarizationClient {
  return {
    enabled: false,

    async complete(input: { systemPrompt: string; userPrompt: string; maxTokens: number }): Promise<string> {
      // When disabled, return a truncated version of the input
      const maxChars = input.maxTokens * 4;
      if (input.userPrompt.length <= maxChars) return input.userPrompt;
      return input.userPrompt.slice(0, maxChars) + '... [truncated]';
    },
  };
}
