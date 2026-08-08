export interface SseEvent {
  id?: string;
  event: string;
  data: Record<string, unknown> | string;
}

/** 13 known Anthropic SSE event types */
const KNOWN_EVENTS = new Set([
  'message_start',
  'content_block_start',
  'content_block_delta',
  'content_block_stop',
  'tool_use',
  'tool_result',
  'message_delta',
  'message_stop',
  'error',
  'done',
  'aborted',
  'usage',
  'ping',
]);

/**
 * Parse an SSE (Server-Sent Events) stream from a ReadableStream.
 *
 * Uses a ReadableStream reader + TextDecoder to incrementally decode chunks,
 * buffers partial frames, and yields parsed events. Unknown event types are
 * silently skipped.
 */
export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: !done });
      }

      // Split on \n\n — SSE frames are delimited by double newlines
      const parts = buffer.split('\n\n');
      // Last segment may be incomplete; keep it in the buffer
      buffer = parts.pop() ?? '';

      for (const frame of parts) {
        if (!frame.trim()) continue;
        const event = parseSseFrame(frame);
        if (event && KNOWN_EVENTS.has(event.event)) {
          yield event;
        }
      }

      if (done) {
        // Process any remaining data after the stream closes
        if (buffer.trim()) {
          const event = parseSseFrame(buffer);
          if (event && KNOWN_EVENTS.has(event.event)) {
            yield event;
          }
        }
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Parse a single SSE frame (one complete event separated by \n\n) */
function parseSseFrame(frame: string): SseEvent | null {
  const out: SseEvent = { event: '', data: {} };

  for (const line of frame.split('\n')) {
    if (line.startsWith('id:')) {
      out.id = line.slice(3).trim();
    } else if (line.startsWith('event:')) {
      out.event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      const raw = line.slice(5).trim();
      try {
        out.data = JSON.parse(raw);
      } catch {
        out.data = raw;
      }
    }
    // Lines starting with ':' are comments — ignored per SSE spec
  }

  return out.event ? out : null;
}
