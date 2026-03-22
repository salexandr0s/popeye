import type { CapabilityContext, ContextReleasePolicy, DomainKind } from '@popeye/contracts';

export function authorizeContextRelease(
  ctx: CapabilityContext,
  taskContext: { runId?: string },
  input: {
    domain: DomainKind;
    sourceRef: string;
    releaseLevel: ContextReleasePolicy;
    tokenEstimate: number;
    resourceType: string;
    requestedBy: string;
    payloadPreview?: string;
  },
): { ok: true; approvalId?: string } | { ok: false; text: string } {
  if (!taskContext.runId || !ctx.authorizeContextRelease) {
    return { ok: true };
  }
  const authorization = ctx.authorizeContextRelease({
    runId: taskContext.runId,
    domain: input.domain,
    sourceRef: input.sourceRef,
    requestedLevel: input.releaseLevel,
    tokenEstimate: input.tokenEstimate,
    resourceType: input.resourceType,
    resourceId: input.sourceRef,
    requestedBy: input.requestedBy,
    ...(input.payloadPreview !== undefined ? { payloadPreview: input.payloadPreview } : {}),
  });
  if (authorization.outcome === 'deny') {
    return { ok: false, text: authorization.reason };
  }
  if (authorization.outcome === 'approval_required') {
    return {
      ok: false,
      text: `${authorization.reason} Approval ID: ${authorization.approvalId ?? 'pending'}`,
    };
  }
  return authorization.approvalId ? { ok: true, approvalId: authorization.approvalId } : { ok: true };
}
