import type { SessionRootKind, SessionRootRecord } from '@popeye/contracts';

export interface SessionSelectionInput {
  kind: SessionRootKind;
  scope: string;
}

export function selectSessionRoot(input: SessionSelectionInput): SessionRootRecord {
  return {
    id: `${input.kind}:${input.scope}`,
    kind: input.kind,
    scope: input.scope,
    createdAt: new Date().toISOString(),
  };
}
