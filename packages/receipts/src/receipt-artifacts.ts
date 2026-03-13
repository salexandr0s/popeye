import { readFileSync, writeFileSync } from 'node:fs';

import type { RuntimePaths } from '@popeye/contracts';

export function writeReceiptArtifact(paths: RuntimePaths, receiptId: string, content: string): string {
  const filePath = `${paths.receiptsByRunDir}/${receiptId}.json`;
  writeFileSync(filePath, content, 'utf8');
  return filePath;
}

export function readReceiptArtifact(paths: RuntimePaths, receiptId: string): string | null {
  try {
    return readFileSync(`${paths.receiptsByRunDir}/${receiptId}.json`, 'utf8');
  } catch {
    return null;
  }
}
