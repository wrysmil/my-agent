/**
 * Unit tests for api-protocol errors.
 * Coverage: RpcErrorCode, RpcError, LEGACY_CODE_MAP, normalizeErrorCode
 */

import { describe, expect, it } from 'vitest';
import {
  type RpcErrorCode,
  type RpcError,
  LEGACY_CODE_MAP,
  normalizeErrorCode,
} from '../../src/lib/api-protocol/errors';

// All 27 error codes (kebab-case)
const ALL_ERROR_CODES: RpcErrorCode[] = [
  'session-not-found',
  'session-expired',
  'session-limit-exceeded',
  'message-not-found',
  'message-too-large',
  'stream-not-found',
  'stream-already-closed',
  'agent-not-found',
  'agent-unavailable',
  'agent-rate-limited',
  'provider-not-found',
  'provider-unavailable',
  'provider-auth-failed',
  'provider-timeout',
  'skill-not-found',
  'skill-execution-failed',
  'invalid-request',
  'invalid-parameter',
  'missing-required-field',
  'unauthorized',
  'forbidden',
  'token-expired',
  'token-invalid',
  'rate-limit-exceeded',
  'internal-error',
  'service-unavailable',
  'upstream-error',
];

describe('RpcErrorCode', () => {
  it('has exactly 27 error codes', () => {
    expect(ALL_ERROR_CODES.length).toBe(27);
  });

  it('all codes are kebab-case', () => {
    for (const code of ALL_ERROR_CODES) {
      expect(code).toMatch(/^[a-z]+(-[a-z]+)*$/);
    }
  });

  it('RpcError accepts RpcErrorCode', () => {
    const error: RpcError = {
      code: 'session-not-found',
      message: 'Session not found',
      details: { sessionId: '123' },
    };
    expect(error.code).toBe('session-not-found');
    expect(error.message).toBe('Session not found');
    expect(error.details).toEqual({ sessionId: '123' });
  });

  it('RpcError works without details', () => {
    const error: RpcError = {
      code: 'invalid-request',
      message: 'Invalid input',
    };
    expect(error.details).toBeUndefined();
  });
});

describe('LEGACY_CODE_MAP', () => {
  it('maps all 27 SCREAMING_SNAKE_CASE to kebab-case', () => {
    const legacyCodes = [
      'SESSION_NOT_FOUND',
      'SESSION_EXPIRED',
      'SESSION_LIMIT_EXCEEDED',
      'MESSAGE_NOT_FOUND',
      'MESSAGE_TOO_LARGE',
      'STREAM_NOT_FOUND',
      'STREAM_ALREADY_CLOSED',
      'AGENT_NOT_FOUND',
      'AGENT_UNAVAILABLE',
      'AGENT_RATE_LIMITED',
      'PROVIDER_NOT_FOUND',
      'PROVIDER_UNAVAILABLE',
      'PROVIDER_AUTH_FAILED',
      'PROVIDER_TIMEOUT',
      'SKILL_NOT_FOUND',
      'SKILL_EXECUTION_FAILED',
      'INVALID_REQUEST',
      'INVALID_PARAMETER',
      'MISSING_REQUIRED_FIELD',
      'UNAUTHORIZED',
      'FORBIDDEN',
      'TOKEN_EXPIRED',
      'TOKEN_INVALID',
      'RATE_LIMIT_EXCEEDED',
      'INTERNAL_ERROR',
      'SERVICE_UNAVAILABLE',
      'UPSTREAM_ERROR',
    ];

    expect(legacyCodes.length).toBe(27);

    for (const legacy of legacyCodes) {
      expect(LEGACY_CODE_MAP[legacy]).toBeDefined();
      expect(typeof LEGACY_CODE_MAP[legacy]).toBe('string');
    }
  });

  it('LEGACY_CODE_MAP values are valid RpcErrorCode', () => {
    for (const [legacy, code] of Object.entries(LEGACY_CODE_MAP)) {
      expect(ALL_ERROR_CODES).toContain(code);
    }
  });

  it('LEGACY_CODE_MAP has exactly 27 entries', () => {
    expect(Object.keys(LEGACY_CODE_MAP).length).toBe(27);
  });
});

describe('normalizeErrorCode', () => {
  it('converts SCREAMING_SNAKE_CASE to kebab-case', () => {
    expect(normalizeErrorCode('SESSION_NOT_FOUND')).toBe('session-not-found');
    expect(normalizeErrorCode('INVALID_REQUEST')).toBe('invalid-request');
    expect(normalizeErrorCode('RATE_LIMIT_EXCEEDED')).toBe('rate-limit-exceeded');
  });

  it('returns kebab-case codes as-is', () => {
    expect(normalizeErrorCode('session-not-found')).toBe('session-not-found');
    expect(normalizeErrorCode('invalid-request')).toBe('invalid-request');
  });

  it('returns unknown codes as-is', () => {
    expect(normalizeErrorCode('unknown-error')).toBe('unknown-error');
    expect(normalizeErrorCode('CUSTOM_ERROR')).toBe('CUSTOM_ERROR');
  });

  it('handles mixed case as unknown', () => {
    // Mixed case is not in LEGACY_CODE_MAP, returns as-is
    expect(normalizeErrorCode('Session_Not_Found')).toBe('Session_Not_Found');
  });

  it('normalizeErrorCode returns RpcErrorCode type', () => {
    const code: RpcErrorCode = normalizeErrorCode('INTERNAL_ERROR');
    expect(code).toBe('internal-error');
  });
});

describe('Error code round-trip', () => {
  it('legacy code → normalize → valid RpcErrorCode', () => {
    for (const [legacy, expected] of Object.entries(LEGACY_CODE_MAP)) {
      const result = normalizeErrorCode(legacy);
      expect(result).toBe(expected);
      expect(ALL_ERROR_CODES).toContain(result);
    }
  });
});

describe('Backward compatibility', () => {
  it('getErrorMessage would work with legacy codes after normalization', () => {
    // This test documents the expected behavior:
    // Old code: ApiErrorCode.SESSION_NOT_FOUND === 'SESSION_NOT_FOUND'
    // New code: RpcErrorCode = 'session-not-found'
    // normalizeErrorCode('SESSION_NOT_FOUND') === 'session-not-found'

    const legacyCode = 'SESSION_NOT_FOUND';
    const normalizedCode = normalizeErrorCode(legacyCode);

    expect(normalizedCode).toBe('session-not-found');
    expect(ALL_ERROR_CODES).toContain(normalizedCode);
  });
});
