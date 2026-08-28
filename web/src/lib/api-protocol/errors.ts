/**
 * Unified RPC error types for the API protocol layer.
 *
 * Replaces the legacy ApiErrorCode enum with a kebab-case union type
 * and a structured RpcError interface.
 */

/** All possible RPC error codes (kebab-case) */
export type RpcErrorCode =
  | 'session-not-found'
  | 'session-expired'
  | 'session-limit-exceeded'
  | 'message-not-found'
  | 'message-too-large'
  | 'stream-not-found'
  | 'stream-already-closed'
  | 'agent-not-found'
  | 'agent-unavailable'
  | 'agent-rate-limited'
  | 'provider-not-found'
  | 'provider-unavailable'
  | 'provider-auth-failed'
  | 'provider-timeout'
  | 'skill-not-found'
  | 'skill-execution-failed'
  | 'invalid-request'
  | 'invalid-parameter'
  | 'missing-required-field'
  | 'unauthorized'
  | 'forbidden'
  | 'token-expired'
  | 'token-invalid'
  | 'rate-limit-exceeded'
  | 'internal-error'
  | 'service-unavailable'
  | 'upstream-error';

/** Structured RPC error with code, message, and optional details */
export interface RpcError {
  code: RpcErrorCode;
  message: string;
  details?: unknown;
}

/**
 * Map from legacy SCREAMING_SNAKE_CASE codes to new kebab-case codes.
 * Used for backward compatibility during migration.
 */
export const LEGACY_CODE_MAP: Record<string, RpcErrorCode> = {
  SESSION_NOT_FOUND: 'session-not-found',
  SESSION_EXPIRED: 'session-expired',
  SESSION_LIMIT_EXCEEDED: 'session-limit-exceeded',
  MESSAGE_NOT_FOUND: 'message-not-found',
  MESSAGE_TOO_LARGE: 'message-too-large',
  STREAM_NOT_FOUND: 'stream-not-found',
  STREAM_ALREADY_CLOSED: 'stream-already-closed',
  AGENT_NOT_FOUND: 'agent-not-found',
  AGENT_UNAVAILABLE: 'agent-unavailable',
  AGENT_RATE_LIMITED: 'agent-rate-limited',
  PROVIDER_NOT_FOUND: 'provider-not-found',
  PROVIDER_UNAVAILABLE: 'provider-unavailable',
  PROVIDER_AUTH_FAILED: 'provider-auth-failed',
  PROVIDER_TIMEOUT: 'provider-timeout',
  SKILL_NOT_FOUND: 'skill-not-found',
  SKILL_EXECUTION_FAILED: 'skill-execution-failed',
  INVALID_REQUEST: 'invalid-request',
  INVALID_PARAMETER: 'invalid-parameter',
  MISSING_REQUIRED_FIELD: 'missing-required-field',
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  TOKEN_EXPIRED: 'token-expired',
  TOKEN_INVALID: 'token-invalid',
  RATE_LIMIT_EXCEEDED: 'rate-limit-exceeded',
  INTERNAL_ERROR: 'internal-error',
  SERVICE_UNAVAILABLE: 'service-unavailable',
  UPSTREAM_ERROR: 'upstream-error',
};

/**
 * Convert a legacy SCREAMING_SNAKE_CASE code to the new kebab-case format.
 * If the code is already in kebab-case or unknown, returns it as-is.
 */
export function normalizeErrorCode(code: string): RpcErrorCode {
  return LEGACY_CODE_MAP[code] || (code as RpcErrorCode);
}
