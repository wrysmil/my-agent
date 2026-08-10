import { describe, it, expect } from 'vitest';
import { parseSseStream } from '../../src/lib/sse';

function mockStream(frames: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(ctrl) {
      for (const f of frames) ctrl.enqueue(enc.encode(f));
      ctrl.close();
    },
  });
}

describe('parseSseStream', () => {
  it('parses message_start + content_block_delta + message_stop', async () => {
    const events: any[] = [];
    const s = mockStream([
      'id: 1\nevent: message_start\ndata: {"streamId":"abc","cid":"c","seq":1}\n\n',
      'id: 2\nevent: content_block_delta\ndata: {"seq":2,"delta":{"text":"hi"}}\n\n',
      'id: 3\nevent: message_stop\ndata: {"seq":3}\n\n',
    ]);
    for await (const e of parseSseStream(s)) events.push(e);
    expect(events.map(e => e.event)).toEqual(['message_start', 'content_block_delta', 'message_stop']);
    expect(events[0].data.streamId).toBe('abc');
  });
  it('skips unknown event type without throwing', async () => {
    const s = mockStream(['event: unknown\ndata: {}\n\n']);
    const events: any[] = [];
    for await (const e of parseSseStream(s)) events.push(e);
    expect(events).toEqual([]);
  });
  it('handles done and usage events', async () => {
    const s = mockStream([
      'event: usage\ndata: {"tokens":100}\n\n',
      'event: done\ndata: {}\n\n',
    ]);
    const events: any[] = [];
    for await (const e of parseSseStream(s)) events.push(e);
    expect(events.map(e => e.event)).toEqual(['usage', 'done']);
  });
});
