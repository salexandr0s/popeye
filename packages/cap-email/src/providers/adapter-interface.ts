/**
 * Provider-neutral adapter interface for email providers.
 * All adapters (GWS CLI, Proton Bridge, direct Gmail) implement this contract.
 * EmailSyncService consumes this interface — it never sees provider-specific types.
 */

// --- Normalized output types (provider-neutral) ---

export interface NormalizedThread {
  threadId: string;
  subject: string;
  snippet: string;
  lastMessageAt: string;
  messageCount: number;
  labelIds: string[];
  isUnread: boolean;
  isStarred: boolean;
  messages: NormalizedMessage[];
}

export interface NormalizedMessage {
  messageId: string;
  threadId: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  snippet: string;
  bodyPreview: string;
  receivedAt: string;
  sizeEstimate: number;
  labelIds: string[];
}

export interface ThreadListPage {
  threads: NormalizedThread[];
  nextPageToken?: string | undefined;
}

// --- History change (for incremental sync) ---

export interface HistoryChange {
  changedThreadIds: string[];
  newHistoryId: string;
}

export interface NormalizedDraft {
  draftId: string;
  messageId?: string | undefined;
  to: string[];
  cc: string[];
  subject: string;
  bodyPreview: string;
  updatedAt: string;
}

// --- Adapter interface ---

export interface EmailProviderAdapter {
  /** Return profile info. historyId is optional (IMAP has no equivalent). */
  getProfile(): Promise<{ emailAddress: string; historyId?: string }>;

  /** List threads with pagination. */
  listThreads(options?: {
    maxResults?: number | undefined;
    pageToken?: string | undefined;
  }): Promise<ThreadListPage>;

  /** Get a single thread with all messages. */
  getThread(threadId: string): Promise<NormalizedThread>;

  /** Get a single message by ID. */
  getMessage(messageId: string): Promise<NormalizedMessage>;

  /**
   * Incremental sync via provider-specific history mechanism.
   * Optional — providers without history support (IMAP) omit this.
   * When absent, sync always does a full pass.
   */
  listHistory?(startHistoryId: string): Promise<HistoryChange>;

  /** Create a provider draft without sending it. */
  createDraft?(input: {
    to: string[];
    cc?: string[] | undefined;
    subject: string;
    body: string;
  }): Promise<NormalizedDraft>;

  /** Update an existing provider draft without sending it. */
  updateDraft?(draftId: string, input: {
    to?: string[] | undefined;
    cc?: string[] | undefined;
    subject?: string | undefined;
    body?: string | undefined;
  }): Promise<NormalizedDraft>;
}
