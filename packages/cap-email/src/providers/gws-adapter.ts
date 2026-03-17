/**
 * Gmail adapter that delegates to the Google Workspace CLI (`gws`).
 * Auth is fully managed by gws — Popeye stores no OAuth tokens.
 *
 * Prerequisites:
 * - gws CLI installed (npm install -g @googleworkspace/cli or brew install googleworkspace-cli)
 * - Authenticated (gws auth login)
 */

import { execFile } from 'node:child_process';

import type {
  EmailProviderAdapter,
  NormalizedThread,
  NormalizedMessage,
  ThreadListPage,
  HistoryChange,
} from './adapter-interface.js';
import type {
  GmailThread,
  GmailMessage,
  GmailProfile,
  GmailThreadListResponse,
  GmailHistoryResponse,
} from './gmail-types.js';
import { normalizeGmailThread, normalizeGmailMessage } from './gmail-normalize.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export interface GwsCliAdapterConfig {
  /** Path to the gws binary. Defaults to 'gws'. */
  gwsPath?: string | undefined;
  /** Timeout for CLI invocations in ms. Defaults to 30s. */
  timeoutMs?: number | undefined;
}

export class GwsCliAdapter implements EmailProviderAdapter {
  private readonly gwsPath: string;
  private readonly timeoutMs: number;

  constructor(config: GwsCliAdapterConfig = {}) {
    this.gwsPath = config.gwsPath ?? 'gws';
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async getProfile(): Promise<GmailProfile> {
    return this.exec<GmailProfile>(['gmail', 'users', 'getProfile']);
  }

  async listThreads(options?: {
    maxResults?: number | undefined;
    pageToken?: string | undefined;
  }): Promise<ThreadListPage> {
    const params: Record<string, unknown> = {};
    if (options?.maxResults) params['maxResults'] = options.maxResults;
    if (options?.pageToken) params['pageToken'] = options.pageToken;

    const raw = await this.exec<GmailThreadListResponse>(
      ['gmail', 'users.threads', 'list', '--params', JSON.stringify(params)],
    );

    if (!raw.threads?.length) {
      return { threads: [] };
    }

    // Fetch full thread details for each stub
    const threads: NormalizedThread[] = [];
    for (const stub of raw.threads) {
      threads.push(await this.getThread(stub.id));
    }

    return { threads, nextPageToken: raw.nextPageToken };
  }

  async getThread(threadId: string): Promise<NormalizedThread> {
    const raw = await this.exec<GmailThread>(
      ['gmail', 'users.threads', 'get', '--params', JSON.stringify({ id: threadId, format: 'full' })],
    );
    return normalizeGmailThread(raw);
  }

  async getMessage(messageId: string): Promise<NormalizedMessage> {
    const raw = await this.exec<GmailMessage>(
      ['gmail', 'users.messages', 'get', '--params', JSON.stringify({ id: messageId, format: 'full' })],
    );
    return normalizeGmailMessage(raw);
  }

  async listHistory(startHistoryId: string): Promise<HistoryChange> {
    const raw = await this.exec<GmailHistoryResponse>(
      ['gmail', 'users', 'history', 'list', '--params', JSON.stringify({
        startHistoryId,
        historyTypes: ['messageAdded'],
      })],
    );

    const changedThreadIds: string[] = [];
    const seen = new Set<string>();
    if (raw.history?.length) {
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

  // --- Internal ---

  private exec<T>(args: string[]): Promise<T> {
    return new Promise((resolve, reject) => {
      execFile(
        this.gwsPath,
        args,
        { timeout: this.timeoutMs, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            // Exit code 2 = auth error in gws
            const exitCode = 'code' in error ? error.code : undefined;
            if (exitCode === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
              reject(new Error(`gws output too large: ${stderr || error.message}`));
              return;
            }
            if (error.message.includes('auth') || error.message.includes('unauthenticated')) {
              reject(new Error(`gws auth error — run "gws auth login" to re-authenticate: ${stderr || error.message}`));
              return;
            }
            reject(new Error(`gws CLI error: ${stderr || error.message}`));
            return;
          }

          try {
            resolve(JSON.parse(stdout) as T);
          } catch {
            reject(new Error(`Failed to parse gws output as JSON: ${stdout.slice(0, 200)}`));
          }
        },
      );
    });
  }
}
