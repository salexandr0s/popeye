import type {
  GmailProfile,
  GmailThread,
  GmailThreadListResponse,
  GmailMessage,
  GmailHistoryResponse,
  GmailDraft,
} from './gmail-types.js';
import type {
  EmailProviderAdapter,
  NormalizedThread,
  NormalizedMessage,
  ThreadListPage,
  HistoryChange,
  NormalizedDraft,
  NormalizedDraftDetail,
} from './adapter-interface.js';
import { extractBodyText, normalizeGmailThread, normalizeGmailMessage } from './gmail-normalize.js';

// Re-export types for backward compatibility
export type { NormalizedThread, NormalizedMessage, ThreadListPage } from './adapter-interface.js';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const MAX_BACKOFF_MS = 32_000;
const MAX_RETRIES = 3;

export interface GmailAdapterConfig {
  accessToken: string;
  refreshToken?: string | undefined;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
}

export class GmailAdapter implements EmailProviderAdapter {
  private accessToken: string;
  private readonly refreshToken: string | undefined;
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;

  constructor(config: GmailAdapterConfig) {
    this.accessToken = config.accessToken;
    this.refreshToken = config.refreshToken;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
  }

  async getProfile(): Promise<GmailProfile> {
    return this.request<GmailProfile>('/profile');
  }

  async listThreads(options: {
    maxResults?: number | undefined;
    pageToken?: string | undefined;
    labelIds?: string[] | undefined;
    query?: string | undefined;
  } = {}): Promise<ThreadListPage> {
    const params = new URLSearchParams();
    if (options.maxResults) params.set('maxResults', String(options.maxResults));
    if (options.pageToken) params.set('pageToken', options.pageToken);
    if (options.labelIds?.length) {
      for (const label of options.labelIds) params.append('labelIds', label);
    }
    if (options.query) params.set('q', options.query);

    const raw = await this.request<GmailThreadListResponse>(
      `/threads?${params.toString()}`,
    );

    if (!raw.threads?.length) {
      return { threads: [] };
    }

    // Fetch full thread details for each thread
    const threads: NormalizedThread[] = [];
    for (const stub of raw.threads) {
      const thread = await this.getThread(stub.id);
      threads.push(thread);
    }

    return { threads, nextPageToken: raw.nextPageToken };
  }

  async getThread(threadId: string): Promise<NormalizedThread> {
    const raw = await this.request<GmailThread>(
      `/threads/${encodeURIComponent(threadId)}?format=full`,
    );
    return normalizeGmailThread(raw);
  }

  async getMessage(messageId: string): Promise<NormalizedMessage> {
    const raw = await this.request<GmailMessage>(
      `/messages/${encodeURIComponent(messageId)}?format=full`,
    );
    return normalizeGmailMessage(raw);
  }

  async listHistory(startHistoryId: string): Promise<HistoryChange> {
    const params = new URLSearchParams({
      startHistoryId,
      historyTypes: 'messageAdded',
    });
    const raw = await this.request<GmailHistoryResponse>(`/history?${params.toString()}`);

    const changedThreadIds: string[] = [];
    if (raw.history?.length) {
      const seen = new Set<string>();
      for (const record of raw.history) {
        if (record.messagesAdded) {
          for (const added of record.messagesAdded) {
            if (!seen.has(added.message.threadId)) {
              seen.add(added.message.threadId);
              changedThreadIds.push(added.message.threadId);
            }
          }
        }
      }
    }

    return { changedThreadIds, newHistoryId: raw.historyId };
  }

  async createDraft(input: {
    to: string[];
    cc?: string[] | undefined;
    subject: string;
    body: string;
  }): Promise<NormalizedDraft> {
    const response = await this.request<GmailDraft>('/drafts', 0, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          raw: buildDraftRawMessage(input),
        },
      }),
    });

    return {
      draftId: response.id,
      messageId: response.message.id,
      to: input.to,
      cc: input.cc ?? [],
      subject: input.subject,
      bodyPreview: input.body.slice(0, 500),
      updatedAt: new Date().toISOString(),
    };
  }

  async updateDraft(draftId: string, input: {
    to?: string[] | undefined;
    cc?: string[] | undefined;
    subject?: string | undefined;
    body?: string | undefined;
  }): Promise<NormalizedDraft> {
    const existingDraft = await this.getDraft(draftId);
    const merged = {
      to: input.to ?? existingDraft.to,
      cc: input.cc ?? existingDraft.cc,
      subject: input.subject ?? existingDraft.subject,
      body: input.body ?? existingDraft.body,
    };

    const response = await this.request<GmailDraft>(`/drafts/${encodeURIComponent(draftId)}`, 0, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: draftId,
        message: {
          raw: buildDraftRawMessage(merged),
        },
      }),
    });

    return {
      draftId: response.id,
      messageId: response.message.id,
      to: merged.to,
      cc: merged.cc,
      subject: merged.subject,
      bodyPreview: merged.body.slice(0, 500),
      updatedAt: new Date().toISOString(),
    };
  }

  async getDraft(draftId: string): Promise<NormalizedDraftDetail> {
    const response = await this.request<GmailDraft>(
      `/drafts/${encodeURIComponent(draftId)}?format=full`,
    );
    const normalizedMessage = normalizeGmailMessage(response.message);
    const updatedAt = Number.isFinite(Number(response.message.internalDate))
      ? new Date(parseInt(response.message.internalDate, 10)).toISOString()
      : new Date().toISOString();

    return {
      draftId: response.id,
      messageId: response.message.id,
      to: normalizedMessage.to,
      cc: normalizedMessage.cc,
      subject: normalizedMessage.subject,
      bodyPreview: normalizedMessage.bodyPreview,
      body: extractBodyText(response.message.payload),
      updatedAt,
    };
  }

  // --- Internal helpers ---

  private async request<T>(
    path: string,
    retryCount = 0,
    init: RequestInit = {},
  ): Promise<T> {
    const url = `${GMAIL_API_BASE}${path}`;
    const response = await fetch(url, {
      method: init.method ?? 'GET',
      headers: { Authorization: `Bearer ${this.accessToken}` },
      ...(init.headers ? { headers: { Authorization: `Bearer ${this.accessToken}`, ...(init.headers as Record<string, string>) } } : {}),
      ...(init.body !== undefined ? { body: init.body } : {}),
    });

    if (response.status === 401 && retryCount === 0 && this.refreshToken) {
      await this.refreshAccessToken();
      return this.request<T>(path, retryCount + 1);
    }

    if (response.status === 429 && retryCount < MAX_RETRIES) {
      const backoff = Math.min(1000 * Math.pow(2, retryCount), MAX_BACKOFF_MS);
      await sleep(backoff);
      return this.request<T>(path, retryCount + 1);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gmail API error ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.refreshToken || !this.clientId || !this.clientSecret) {
      throw new Error('Cannot refresh: missing refresh token or client credentials');
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const data = await response.json() as { access_token: string };
    this.accessToken = data.access_token;
  }
}

function buildDraftRawMessage(input: {
  to: string[];
  cc?: string[] | undefined;
  subject: string;
  body: string;
}): string {
  const lines = [
    `To: ${input.to.join(', ')}`,
    ...(input.cc && input.cc.length > 0 ? [`Cc: ${input.cc.join(', ')}`] : []),
    `Subject: ${input.subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
    '',
    input.body,
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
