/**
 * Unit tests for api-protocol types.
 * Coverage: RpcId, RpcOk, RpcErr, RpcResult, Four-quadrant discriminated union
 */

import { describe, expect, it } from 'vitest';
import {
  RpcId,
  type RpcMessage,
  type ClientRequest,
  type ServerResponse,
  type ServerRequest,
  type ClientResponse,
  type RpcOk,
  type RpcErr,
  type RpcResult,
} from '../../src/lib/api-protocol/types';

describe('RpcId', () => {
  it('mint() generates a valid UUID', () => {
    const id = RpcId.mint();
    expect(id.value).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('mint() generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => RpcId.mint().value));
    expect(ids.size).toBe(100);
  });

  it('from() creates RpcId from string', () => {
    const id = RpcId.from('test-string-123');
    expect(id.value).toBe('test-string-123');
  });

  it('is() type guard works', () => {
    const id = RpcId.mint();
    expect(RpcId.is(id)).toBe(true);
    expect(RpcId.is('not-an-rpc-id')).toBe(false);
    expect(RpcId.is(null)).toBe(false);
    expect(RpcId.is(undefined)).toBe(false);
  });

  it('toString() returns value', () => {
    const id = RpcId.from('my-id');
    expect(id.toString()).toBe('my-id');
  });

  it('toJSON() returns value', () => {
    const id = RpcId.from('my-id');
    expect(id.toJSON()).toBe('my-id');
    expect(JSON.stringify({ id })).toBe('{"id":"my-id"}');
  });
});

describe('RpcOk / RpcErr / RpcResult', () => {
  it('RpcOk structure', () => {
    const ok: RpcOk<{ user: string }> = { ok: true, data: { user: 'test' } };
    expect(ok.ok).toBe(true);
    expect(ok.data).toEqual({ user: 'test' });
  });

  it('RpcErr structure', () => {
    const err: RpcErr = { ok: false, code: 'invalid-request', message: 'Bad input' };
    expect(err.ok).toBe(false);
    expect(err.code).toBe('invalid-request');
    expect(err.message).toBe('Bad input');
  });

  it('RpcResult is RpcOk | RpcErr', () => {
    const okResult: RpcResult<number> = { ok: true, data: 42 };
    const errResult: RpcResult<number> = { ok: false, code: 'invalid-request' };
    expect(okResult.ok).toBe(true);
    expect(errResult.ok).toBe(false);
  });
});

describe('Four-quadrant discriminated union', () => {
  it('ClientRequest narrows correctly', () => {
    const msg: RpcMessage = {
      type: 'client-request',
      rpcId: RpcId.mint(),
      method: 'session.prompt',
      payload: { text: 'hello' },
    };

    if (msg.type === 'client-request') {
      expect(msg.method).toBe('session.prompt');
      expect(msg.payload).toEqual({ text: 'hello' });
    }
  });

  it('ServerResponse narrows correctly', () => {
    const msg: RpcMessage = {
      type: 'server-response',
      rpcId: RpcId.mint(),
      result: { ok: true, data: 'response' },
    };

    if (msg.type === 'server-response') {
      expect(msg.result.ok).toBe(true);
    }
  });

  it('ServerRequest narrows correctly', () => {
    const msg: RpcMessage = {
      type: 'server-request',
      rpcId: RpcId.mint(),
      method: 'approval/requested',
      payload: { id: '1', tool: 'bash', args: {} },
    };

    if (msg.type === 'server-request') {
      expect(msg.method).toBe('approval/requested');
      expect((msg.payload as { id: string }).id).toBe('1');
    }
  });

  it('ClientResponse narrows correctly', () => {
    const msg: RpcMessage = {
      type: 'client-response',
      rpcId: RpcId.mint(),
      result: { ok: true, value: 'approved' },
    };

    if (msg.type === 'client-response') {
      expect(msg.result.ok).toBe(true);
    }
  });

  it('switch exhaustiveness check - all branches covered', () => {
    function getMessageType(msg: RpcMessage): string {
      switch (msg.type) {
        case 'client-request':
          return `request:${msg.method}`;
        case 'server-response':
          return msg.result.ok ? 'success' : 'error';
        case 'server-request':
          return `event:${msg.method}`;
        case 'client-response':
          return `response:${msg.result.ok}`;
      }
    }

    expect(getMessageType({ type: 'client-request', rpcId: RpcId.mint(), method: 'test', payload: null }))
      .toBe('request:test');
    expect(getMessageType({ type: 'server-response', rpcId: RpcId.mint(), result: { ok: true, data: null } }))
      .toBe('success');
    expect(getMessageType({ type: 'server-request', rpcId: RpcId.mint(), method: 'test', payload: null }))
      .toBe('event:test');
    expect(getMessageType({ type: 'client-response', rpcId: RpcId.mint(), result: { ok: true, value: null } }))
      .toBe('response:true');
  });
});

describe('Type assignments for each quadrant', () => {
  it('ClientRequest assignment', () => {
    const request: ClientRequest = {
      type: 'client-request',
      rpcId: RpcId.mint(),
      method: 'session.prompt',
      payload: { text: 'Hello, world!', sessionId: 'sess-123' },
    };
    expect(request.type).toBe('client-request');
  });

  it('ServerResponse assignment', () => {
    const response: ServerResponse = {
      type: 'server-response',
      rpcId: RpcId.mint(),
      result: { ok: true, data: { messages: [] } },
    };
    expect(response.type).toBe('server-response');
  });

  it('ServerRequest assignment', () => {
    const request: ServerRequest = {
      type: 'server-request',
      rpcId: RpcId.mint(),
      method: 'session/message-start',
      payload: { sessionId: 'sess-123' },
    };
    expect(request.type).toBe('server-request');
  });

  it('ClientResponse assignment', () => {
    const response: ClientResponse = {
      type: 'client-response',
      rpcId: RpcId.mint(),
      result: { ok: true, value: { outcome: 'allow' } },
    };
    expect(response.type).toBe('client-response');
  });
});
