import { z } from 'zod';

export const PluginToolSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/),
  description: z.string().min(1),
  inputSchema: z.record(z.string(), z.unknown()),
  command: z.string().min(1),
  timeoutMs: z.number().int().positive().default(30_000),
  env: z.record(z.string(), z.string()).default({}),
});
export type PluginTool = z.infer<typeof PluginToolSchema>;

export const PluginManifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1),
  version: z.string().default('0.0.0'),
  tools: z.array(PluginToolSchema).min(1),
});
export type PluginManifest = z.infer<typeof PluginManifestSchema>;
