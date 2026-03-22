export interface CanonicalRunReply {
  source: 'completed_output' | 'assistant_message' | 'receipt_fallback';
  text: string;
}
