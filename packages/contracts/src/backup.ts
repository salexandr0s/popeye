import { z } from 'zod';

export const BackupManifestSchema = z.object({
  version: z.string(),
  createdAt: z.string(),
  entries: z.array(
    z.object({
      path: z.string(),
      sha256: z.string(),
      kind: z.enum(['file', 'directory']),
    }),
  ),
});
export type BackupManifest = z.infer<typeof BackupManifestSchema>;
