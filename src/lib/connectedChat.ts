import type { ModelKeyStatus } from './accessTier';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTERRUPTED = 'The answer was interrupted. Refresh history before retrying.';
type BoundThread = { id: string; user_id?: string; provider_connection_id?: string | null; selected_model?: string | null };
type CanonicalUserMessage = { id: string; thread_id: string; user_id?: string; content: string };

/** Even an invalid non-null binding must never fall back to an OpenRouter runtime. */
export const isConnectedChat = (thread: BoundThread | undefined | null): boolean => thread?.provider_connection_id != null;
export const requiresOpenRouterKey = (thread: BoundThread | undefined | null, status: ModelKeyStatus): boolean =>
  !isConnectedChat(thread) && status !== 'present';

export function connectedChatRequest(thread: BoundThread, message: CanonicalUserMessage) {
  if (!isConnectedChat(thread) || !UUID.test(thread.id) || !UUID.test(thread.provider_connection_id!) ||
      !UUID.test(message.id) || message.thread_id !== thread.id ||
      (thread.user_id && message.user_id !== thread.user_id) ||
      typeof thread.selected_model !== 'string' || !thread.selected_model.trim() || thread.selected_model.length > 512 ||
      typeof message.content !== 'string' || !message.content.trim()) {
    throw new Error('This connected conversation needs its saved account, model, and user message. Refresh history before retrying.');
  }
  return {
    thread_id: thread.id,
    user_message_id: message.id,
    connection_id: thread.provider_connection_id!,
    model: thread.selected_model,
    message: message.content,
  };
}

export type ConnectedChatResult =
  | { status: 'complete'; content: string; messageId: string; model: string; tokensUsed: number | null }
  | { status: 'interrupted'; content: string; message: string; code: string };

/** Reads exactly one response. EOF, failure, or cancellation never starts another paid request. */
export async function readConnectedChatStream(response: Response, onContent: (content: string) => void): Promise<ConnectedChatResult> {
  let content = '';
  const interrupted = (message = INTERRUPTED, code = 'provider_interrupted'): ConnectedChatResult => ({ status: 'interrupted', content, message, code });
  if (!response.body || !response.headers.get('Content-Type')?.toLowerCase().startsWith('text/event-stream')) return interrupted();
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', wireBytes = 0;
  const block = (value: string): ConnectedChatResult | null => {
    const payload = value.split(/\r?\n/).filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart()).join('\n');
    if (!payload) return null;
    const event: unknown = JSON.parse(payload);
    if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Malformed event');
    const data = event as Record<string, unknown>;
    if (data.type === 'content' && typeof data.text === 'string') {
      if (content.length + data.text.length > 2_000_000) throw new Error('Response too large');
      content += data.text;
      onContent(content);
      return null;
    }
    if (data.type === 'error') {
      return interrupted(typeof data.text === 'string' && data.text.length <= 2000 ? data.text : INTERRUPTED,
        typeof data.code === 'string' && data.code.length <= 100 ? data.code : 'provider_interrupted');
    }
    if (data.type !== 'done' || typeof data.message_id !== 'string' || !UUID.test(data.message_id) ||
        typeof data.model !== 'string' || !data.model || data.model.length > 512 || !content.trim() ||
        !(data.tokens_used === null || (typeof data.tokens_used === 'number' && Number.isSafeInteger(data.tokens_used) && data.tokens_used >= 0))) {
      throw new Error('Malformed completion');
    }
    return { status: 'complete', content, messageId: data.message_id, model: data.model, tokensUsed: data.tokens_used as number | null };
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) {
        wireBytes += value.byteLength;
        if (wireBytes > 8_000_000) return interrupted();
        buffer += decoder.decode(value, { stream: true });
      }
      if (done) buffer += decoder.decode();
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? '';
      for (const item of blocks) {
        const result = block(item);
        if (result) return result;
      }
      if (buffer.length > 2_100_000) return interrupted();
      if (done) return buffer.trim() ? block(buffer) ?? interrupted() : interrupted();
    }
  } catch {
    return interrupted();
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
