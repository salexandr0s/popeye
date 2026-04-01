import { normalize } from 'node:path';

import type { CriticalFileMutationRequest, CriticalFilePolicyDecision } from '@popeye/contracts';

const PROTECTED_SEGMENTS = ['WORKSPACE.md', 'PROJECT.md', 'IDENTITY.md', 'SOUL.md', 'AGENTS.md', 'HEARTBEAT.md'];
const PROTECTED_PATH_SEGMENTS = ['/.popeye/context/'];

export function evaluateCriticalFileMutation(
  request: CriticalFileMutationRequest,
): CriticalFilePolicyDecision {
  const normalizedPath = normalize(request.path);
  const protectedFile = PROTECTED_SEGMENTS.some((fileName) => normalizedPath.endsWith(fileName));
  const protectedPath = PROTECTED_PATH_SEGMENTS.some((segment) => normalizedPath.includes(segment));

  if (!protectedFile && !protectedPath) {
    return {
      allowed: true,
      reason: 'non-critical file',
      requiresReceipt: false,
    };
  }

  if (!request.approved) {
    return {
      allowed: false,
      reason: 'critical file requires explicit approval',
      requiresReceipt: true,
    };
  }

  return {
    allowed: true,
    reason: 'approved critical file mutation',
    requiresReceipt: true,
  };
}
