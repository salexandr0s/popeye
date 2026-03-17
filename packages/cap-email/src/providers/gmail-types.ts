/** Raw Gmail API response types — typed minimally for what we consume. */

export interface GmailProfile {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
}

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailMessagePartBody {
  size: number;
  data?: string; // base64url-encoded
}

export interface GmailMessagePart {
  partId?: string;
  mimeType: string;
  headers: GmailHeader[];
  body: GmailMessagePartBody;
  parts?: GmailMessagePart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet: string;
  historyId: string;
  internalDate: string; // epoch ms as string
  payload: GmailMessagePart;
  sizeEstimate: number;
}

export interface GmailThread {
  id: string;
  historyId: string;
  messages?: GmailMessage[];
  snippet?: string;
}

export interface GmailThreadListResponse {
  threads?: Array<{ id: string; snippet: string; historyId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

export interface GmailMessageListResponse {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

export interface GmailHistoryRecord {
  id: string;
  messages?: Array<{ id: string; threadId: string }>;
  messagesAdded?: Array<{ message: { id: string; threadId: string; labelIds?: string[] } }>;
  messagesDeleted?: Array<{ message: { id: string; threadId: string } }>;
  labelsAdded?: Array<{ message: { id: string; threadId: string }; labelIds: string[] }>;
  labelsRemoved?: Array<{ message: { id: string; threadId: string }; labelIds: string[] }>;
}

export interface GmailHistoryResponse {
  history?: GmailHistoryRecord[];
  nextPageToken?: string;
  historyId: string;
}

export interface GmailErrorResponse {
  error: {
    code: number;
    message: string;
    status: string;
    errors?: Array<{ domain: string; reason: string; message: string }>;
  };
}
