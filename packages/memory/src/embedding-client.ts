import { redactText } from '@popeye/observability';

export interface EmbeddingClient {
  embed(texts: string[]): Promise<Float32Array[]>;
  readonly dimensions: number;
  readonly model: string;
  readonly enabled: boolean;
}

export function createOpenAIEmbeddingClient(config: { model: string; dimensions: number }): EmbeddingClient {
  return {
    dimensions: config.dimensions,
    model: config.model,
    enabled: true,

    async embed(texts: string[]): Promise<Float32Array[]> {
      const apiKey = process.env['OPENAI_API_KEY'];
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY environment variable is not set');
      }

      const redactedTexts = texts.map((t) => redactText(t).text);
      const results: Float32Array[] = [];

      // Batch in chunks of 2048
      for (let i = 0; i < redactedTexts.length; i += 2048) {
        const batch = redactedTexts.slice(i, i + 2048);

        const response = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: config.model,
            input: batch,
            dimensions: config.dimensions,
          }),
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`OpenAI embeddings API error (${response.status}): ${body}`);
        }

        const json = (await response.json()) as {
          data: Array<{ embedding: number[] }>;
        };

        for (const item of json.data) {
          results.push(new Float32Array(item.embedding));
        }
      }

      return results;
    },
  };
}

export function createDisabledEmbeddingClient(): EmbeddingClient {
  return {
    dimensions: 0,
    model: 'disabled',
    enabled: false,

    async embed(): Promise<Float32Array[]> {
      return [];
    },
  };
}
