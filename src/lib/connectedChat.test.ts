import { describe, expect, it, vi } from 'vitest';
import { connectedChatRequest, isConnectedChat, readConnectedChatStream } from './connectedChat';
import { dedupeMessagesForDisplay, mergeRealtimeMessage, useThreadStore, type Message, type Thread } from '@/stores/threadStore';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: vi.fn() } }));

const thread = {
  id: '11111111-1111-4111-8111-111111111111',
  user_id: '22222222-2222-4222-8222-222222222222',
  provider_connection_id: '33333333-3333-4333-8333-333333333333',
  selected_model: 'claude-native-fixture',
};
const message = { id: '44444444-4444-4444-8444-444444444444', thread_id: thread.id, user_id: thread.user_id, content: 'Actual user text, without simulation directives' };
const answer = '55555555-5555-4555-8555-555555555555';
const done = { type: 'done', message_id: answer, model: thread.selected_model, tokens_used: 0 };
function response(events: unknown[], options: { fragmented?: boolean; tail?: boolean; drop?: boolean } = {}) {
  const bytes = new TextEncoder().encode(': keepalive\r\n\r\n' + events.map(event => `data: ${JSON.stringify(event)}`).join('\r\n\r\n') + (options.tail ? '' : '\r\n\r\n'));
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    if (options.fragmented) for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    else controller.enqueue(bytes);
    if (options.drop) controller.error(new Error('raw transport detail'));
    else controller.close();
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
}

describe('connected cloud chat policy', () => {
  it('routes any non-null binding to the provider path and uses canonical saved identity/model/text', () => {
    expect(isConnectedChat(thread)).toBe(true);
    expect(isConnectedChat({ ...thread, provider_connection_id: '' })).toBe(true);
    expect(isConnectedChat({ ...thread, provider_connection_id: null })).toBe(false);
    expect(isConnectedChat(undefined)).toBe(false);
    expect(connectedChatRequest(thread, message)).toEqual({ thread_id: thread.id, user_message_id: message.id,
      connection_id: thread.provider_connection_id, model: thread.selected_model, message: message.content });
  });

  it('fails closed for missing binding/model, noncanonical identity, or a message from another owner/thread', () => {
    for (const changed of [{ provider_connection_id: null }, { provider_connection_id: '' }, { selected_model: null }, { selected_model: '' }]) {
      expect(() => connectedChatRequest({ ...thread, ...changed }, message)).toThrow();
    }
    for (const changed of [{ id: 'msg_upstream_id' }, { thread_id: answer }, { user_id: answer }, { content: '' }]) {
      expect(() => connectedChatRequest(thread, { ...message, ...changed })).toThrow();
    }
  });

  it('preserves fragmented UTF-8 content and only accepts the canonical done UUID', async () => {
    const chunks: string[] = [];
    const result = await readConnectedChatStream(response([{ type: 'content', text: 'Hello ' }, { type: 'content', text: '✓' }, done], { fragmented: true, tail: true }), value => chunks.push(value));
    expect(result).toEqual({ status: 'complete', content: 'Hello ✓', messageId: answer, model: thread.selected_model, tokensUsed: 0 });
    expect(chunks).toEqual(['Hello ', 'Hello ✓']);
  });

  it('retains partial content on EOF without declaring success or making any retry', async () => {
    const partial = await readConnectedChatStream(response([{ type: 'content', text: 'Partial reply' }]), () => undefined);
    expect(partial).toMatchObject({ status: 'interrupted', content: 'Partial reply', code: 'provider_interrupted' });
  });

  it('never invents an assistant identity for missing or opaque done IDs or invalid accounting', async () => {
    for (const changed of [{ message_id: null }, { message_id: 'msg_native_upstream' }, { model: '' }, { tokens_used: -1 }, { tokens_used: '12' }]) {
      expect(await readConnectedChatStream(response([{ type: 'content', text: 'Reply' }, { ...done, ...changed }]), () => undefined))
        .toMatchObject({ status: 'interrupted', content: 'Reply' });
    }
  });

  it('preserves typed provider errors and their partial answer', async () => {
    const result = await readConnectedChatStream(response([{ type: 'content', text: 'Partial' }, { type: 'error', code: 'provider_credits_required', text: 'Available API credits are required.' }]), () => undefined);
    expect(result).toEqual({ status: 'interrupted', content: 'Partial', code: 'provider_credits_required', message: 'Available API credits are required.' });
  });

  it('does not misread HTML, malformed JSON/events, missing body, or a dropped transport as success', async () => {
    const responses = [new Response('<html>error</html>'), new Response(null, { headers: { 'Content-Type': 'text/event-stream' } }),
      new Response('data: {bad json}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }),
      response([{ type: 'tool_result', text: 'unsupported' }]), response([], { drop: true })];
    for (const candidate of responses) expect(await readConnectedChatStream(candidate, () => undefined)).toMatchObject({ status: 'interrupted' });
  });

  it('keeps distinct canonical provider turns even when identical content arrives within the legacy dedupe window', () => {
    const first: Message = { id: answer, thread_id: thread.id, user_id: thread.user_id, role: 'assistant', content: 'Same reply', model: thread.selected_model,
      agent: 'luca', thinking_content: null, tokens_used: 0, bookmarked: false, created_at: new Date().toISOString(),
      metadata: { provider_connection_id: thread.provider_connection_id, provider_turn_id: message.id, local_stream_stub: true } };
    const second: Message = { ...first, id: message.id, metadata: { ...first.metadata, provider_turn_id: answer } };
    expect(dedupeMessagesForDisplay([first, second])).toEqual([first, second]);
    expect(mergeRealtimeMessage([first], second)).toEqual([first, second]);
    useThreadStore.setState({ messages: [] });
    useThreadStore.getState().addMessage(first);
    useThreadStore.getState().addMessage(second);
    expect(useThreadStore.getState().messages.map(row => row.id)).toEqual([first.id, second.id]);
    const canonical = { ...first, metadata: { provider_connection_id: thread.provider_connection_id, provider_turn_id: message.id } };
    expect(mergeRealtimeMessage([first], canonical)).toEqual([canonical]);
    useThreadStore.setState({ messages: [] });
  });

  it('prevents store target mutations from moving a connected thread to the OpenRouter runtime', async () => {
    const bound: Thread = { ...thread, title: null, pinned: false, starred: false, archived: false, heat: 'warm',
      agent_id: 'luca', primary_agent_id: 'luca', participating_agent_ids: ['luca'], project_id: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    useThreadStore.setState({ threads: [bound] });
    await expect(useThreadStore.getState().updateThreadAgent(thread.id, 'other-agent')).rejects.toThrow('connected conversation');
    await expect(useThreadStore.getState().updateThreadSelectedModel(thread.id, 'openrouter/model')).rejects.toThrow('connected conversation');
    expect(useThreadStore.getState().threads[0]).toEqual(bound);
    useThreadStore.setState({ threads: [] });
  });
});
