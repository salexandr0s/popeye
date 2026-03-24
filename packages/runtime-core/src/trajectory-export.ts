import type { RunEventRecord, ShareGPTConversation, ShareGPTMessage } from '@popeye/contracts';

// ---------------------------------------------------------------------------
// Event filtering
// ---------------------------------------------------------------------------

/**
 * Filter events by type list.
 */
export function filterEventsByTypes(
  events: RunEventRecord[],
  types: string[],
): RunEventRecord[] {
  const allowed = new Set(types);
  return events.filter((event) => allowed.has(event.type));
}

// ---------------------------------------------------------------------------
// Payload parsing
// ---------------------------------------------------------------------------

interface ParsedPayload {
  [key: string]: unknown;
}

function safeParsePayload(payload: string): ParsedPayload {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as ParsedPayload;
    }
    return {};
  } catch {
    return {};
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '{}';
  }
}

// ---------------------------------------------------------------------------
// JSONL formatter
// ---------------------------------------------------------------------------

/**
 * Format run events as newline-delimited JSON (JSONL).
 * Each line is a JSON object: { type, payload, createdAt }
 * Optionally filter by event types.
 */
export function formatTrajectoryJsonl(
  events: RunEventRecord[],
  filterTypes?: string[],
): string {
  const filtered = filterTypes ? filterEventsByTypes(events, filterTypes) : events;
  return filtered
    .map((event) => {
      const payload = safeParsePayload(event.payload);
      return JSON.stringify({
        type: event.type,
        payload,
        createdAt: event.createdAt,
      });
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// ShareGPT formatter
// ---------------------------------------------------------------------------

/** Map event type + payload to a ShareGPT role. Returns null to skip. */
function mapEventToShareGPTMessage(
  eventType: string,
  payload: ParsedPayload,
  rawPayload: string,
): ShareGPTMessage | null {
  switch (eventType) {
    case 'message': {
      const role = typeof payload.role === 'string' ? payload.role : '';
      const content = typeof payload.content === 'string' ? payload.content : safeStringify(payload);
      if (role === 'user') {
        return { from: 'human', value: content };
      }
      if (role === 'assistant') {
        return { from: 'gpt', value: content };
      }
      // Unknown role — treat as system
      return { from: 'system', value: content };
    }

    case 'tool_call': {
      const toolName = typeof payload.toolName === 'string' ? payload.toolName : 'unknown';
      const input = payload.input !== undefined ? safeStringify(payload.input) : '{}';
      return {
        from: 'gpt',
        value: `[Tool call: ${toolName}]\n${input}`,
      };
    }

    case 'tool_result': {
      const toolName = typeof payload.toolName === 'string' ? payload.toolName : 'unknown';
      const content = typeof payload.content === 'string' ? payload.content : safeStringify(payload);
      return {
        from: 'tool',
        value: `[Tool result: ${toolName}]\n${content}`,
      };
    }

    case 'session':
      // Internal session management — skip
      return null;

    case 'started':
      return {
        from: 'system',
        value: typeof payload.input === 'string'
          ? `[Run started] Prompt: ${payload.input}`
          : '[Run started]',
      };

    case 'completed':
      return {
        from: 'system',
        value: typeof payload.output === 'string'
          ? `[Run completed] ${payload.output}`
          : '[Run completed]',
      };

    case 'failed':
      return {
        from: 'system',
        value: typeof payload.error === 'string'
          ? `[Run failed] ${payload.error}`
          : '[Run failed]',
      };

    case 'usage': {
      const model = typeof payload.model === 'string' ? payload.model : 'unknown';
      const tokensIn = typeof payload.tokensIn === 'number' ? payload.tokensIn : 0;
      const tokensOut = typeof payload.tokensOut === 'number' ? payload.tokensOut : 0;
      return {
        from: 'system',
        value: `[Usage] ${model}: ${tokensIn} in / ${tokensOut} out`,
      };
    }

    case 'compaction': {
      const tokensBefore = typeof payload.tokensBefore === 'number' ? payload.tokensBefore : null;
      const tokensAfter = typeof payload.tokensAfter === 'number' ? payload.tokensAfter : null;
      const detail = tokensBefore !== null && tokensAfter !== null
        ? `${tokensBefore} → ${tokensAfter} tokens`
        : '';
      return {
        from: 'system',
        value: detail ? `[Compaction] ${detail}` : '[Compaction]',
      };
    }

    case 'model_routing':
      return {
        from: 'system',
        value: typeof payload.model === 'string'
          ? `[Model routing] Routed to ${payload.model}`
          : '[Model routing]',
      };

    case 'budget_warning': {
      const used = typeof payload.iterationsUsed === 'number' ? payload.iterationsUsed : '?';
      const max = typeof payload.maxIterations === 'number' ? payload.maxIterations : '?';
      return {
        from: 'system',
        value: `[Budget warning] ${used}/${max} iterations used`,
      };
    }

    case 'budget_exhausted': {
      const used = typeof payload.iterationsUsed === 'number' ? payload.iterationsUsed : '?';
      const max = typeof payload.maxIterations === 'number' ? payload.maxIterations : '?';
      return {
        from: 'system',
        value: `[Budget exhausted] ${used}/${max} iterations used`,
      };
    }

    case 'delegation_started':
      return {
        from: 'system',
        value: typeof payload.childRunId === 'string'
          ? `[Delegation started] Child run: ${payload.childRunId}`
          : '[Delegation started]',
      };

    case 'delegation_completed':
      return {
        from: 'system',
        value: typeof payload.childRunId === 'string'
          ? `[Delegation completed] Child run: ${payload.childRunId}`
          : '[Delegation completed]',
      };

    default:
      // Unknown event type — include as system for completeness
      return {
        from: 'system',
        value: `[${eventType}] ${rawPayload}`,
      };
  }
}

/**
 * Format run events as a ShareGPT conversation.
 * Maps engine event types to ShareGPT roles:
 *   - message with payload.role='user' -> from: 'human'
 *   - message with payload.role='assistant' -> from: 'gpt'
 *   - tool_call -> from: 'gpt' (with function call info)
 *   - tool_result -> from: 'tool'
 *   - started/completed/failed/usage/compaction/model_routing/budget_* -> from: 'system'
 *   - session -> skip (internal)
 *
 * Payload is stored as a JSON string in RunEventRecord.payload —
 * parse it to extract role and content.
 */
export function formatTrajectoryShareGPT(
  events: RunEventRecord[],
  runId: string,
  status: string,
  usage?: { model?: string; tokensIn?: number; tokensOut?: number; estimatedCostUsd?: number },
  filterTypes?: string[],
): ShareGPTConversation {
  const filtered = filterTypes ? filterEventsByTypes(events, filterTypes) : events;

  const conversations: ShareGPTMessage[] = [];
  for (const event of filtered) {
    const payload = safeParsePayload(event.payload);
    const message = mapEventToShareGPTMessage(event.type, payload, event.payload);
    if (message !== null) {
      conversations.push(message);
    }
  }

  return {
    id: runId,
    conversations,
    metadata: {
      runId,
      status,
      ...(usage?.model !== undefined ? { model: usage.model } : {}),
      ...(usage?.tokensIn !== undefined ? { tokensIn: usage.tokensIn } : {}),
      ...(usage?.tokensOut !== undefined ? { tokensOut: usage.tokensOut } : {}),
      ...(usage?.estimatedCostUsd !== undefined ? { estimatedCostUsd: usage.estimatedCostUsd } : {}),
    },
  };
}
