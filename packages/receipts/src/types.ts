import type { DbConnection, MemorySourceType, MemoryType, RuntimePaths } from '@popeye/contracts';

export interface ReceiptDeps {
  app: DbConnection;
  paths: RuntimePaths;
}

export interface MemoryInsertInput {
  description: string;
  classification: 'secret' | 'sensitive' | 'internal' | 'embeddable';
  sourceType: MemorySourceType;
  content: string;
  confidence: number;
  scope: string;
  memoryType?: MemoryType;
  sourceRef?: string;
  sourceRefType?: string;
}

export interface ReceiptCallbacks {
  captureMemory(input: MemoryInsertInput): void;
}
