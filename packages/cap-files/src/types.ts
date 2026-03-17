import type { CapabilityContext } from '@popeye/contracts';

export interface FileRootRow {
  id: string;
  workspace_id: string;
  label: string;
  root_path: string;
  permission: string;
  file_patterns: string;
  exclude_patterns: string;
  max_file_size_bytes: number;
  enabled: number;
  last_indexed_at: string | null;
  last_indexed_count: number;
  created_at: string;
  updated_at: string;
}

export interface FileDocumentRow {
  id: string;
  file_root_id: string;
  relative_path: string;
  content_hash: string;
  size_bytes: number;
  memory_id: string | null;
  created_at: string;
  updated_at: string;
}

export type FilesCapabilityDb = CapabilityContext['appDb'];
