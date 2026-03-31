import type { PlaybookStaleCandidate } from '@popeye/contracts';

export function buildPlaybookRepairSummary(candidate: PlaybookStaleCandidate): string {
  const interventionLabel = candidate.interventions30d === 1 ? 'intervention' : 'interventions';
  const normalizedReasons = candidate.reasons
    .map((reason) => reason.trim().replace(/\.$/, ''))
    .filter((reason) => reason.length > 0);
  const reasonsSuffix = normalizedReasons.length > 0
    ? ` Reasons: ${normalizedReasons.join(', ')}.`
    : '';
  return `Stale follow-up: ${candidate.useCount30d} uses / ${candidate.failedRuns30d} failed runs / ${candidate.interventions30d} ${interventionLabel} in trailing 30 days.${reasonsSuffix}`;
}

export function buildPlaybookProposalAuthoringPath(input: {
  kind: 'draft';
} | {
  kind: 'patch';
  recordId: string;
  repairSummary?: string;
}): string {
  const params = new URLSearchParams({ kind: input.kind });
  if (input.kind === 'patch') {
    params.set('recordId', input.recordId);
    if (input.repairSummary && input.repairSummary.trim().length > 0) {
      params.set('repairSummary', input.repairSummary.trim());
    }
  }
  return `/playbook-proposals/new?${params.toString()}`;
}
