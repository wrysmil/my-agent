import { z } from 'zod';
import { RpcErrorCode, normalizeErrorCode } from './api-protocol/errors';

/** Re-export RpcErrorCode for backward compatibility */
export type { RpcErrorCode };

/**
 * @deprecated Use RpcErrorCode from './api-protocol/errors' instead.
 * Kept for backward compatibility during migration.
 */
export type ApiErrorCode = RpcErrorCode;

/** Structured error thrown by all api* helpers on non-2xx responses */
export class ApiError extends Error {
  code: RpcErrorCode;
  status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = normalizeErrorCode(code);
    this.status = status;
  }
}

/** Zod schema for the generic JSON error body returned by the backend */
const errorResponseSchema = z.object({
  code: z.string(),
  message: z.string().optional(),
  details: z.unknown().optional(),
});

const BASE_URL = '';

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  // Read body once
  let json: any;
  try {
    const text = await res.text();
    if (!text) {
      // 204 No Content or empty body
      if (!res.ok) {
        throw new ApiError('UNKNOWN_ERROR', res.status, `HTTP ${res.status}`);
      }
      return undefined as T;
    }
    json = JSON.parse(text);
  } catch (e) {
    if (!res.ok) {
      throw new ApiError('UNKNOWN_ERROR', res.status, `HTTP ${res.status}`);
    }
    // Non-JSON response but 2xx — return as-is
    return undefined as T;
  }

  // Backend wraps all responses in { ok: true, data } / { ok: false, error } envelope
  if (json && typeof json === 'object' && 'ok' in json) {
    if (json.ok === false) {
      const errCode = json.error?.code || 'UNKNOWN_ERROR';
      const errMsg = json.error?.message || `HTTP ${res.status}`;
      throw new ApiError(errCode, res.status, errMsg);
    }
    // Success: unwrap data field
    return (json.data ?? json) as T;
  }

  // Non-envelope response (fallback for non-backend endpoints)
  if (!res.ok) {
    let code = 'UNKNOWN_ERROR';
    let message = `HTTP ${res.status}`;
    try {
      const parsed = errorResponseSchema.safeParse(json);
      if (parsed.success) {
        code = parsed.data.code;
        message = parsed.data.message || message;
      }
    } catch {
      // keep defaults
    }
    throw new ApiError(code, res.status, message);
  }

  return json as T;
}

export async function apiGet<T = unknown>(url: string): Promise<T> {
  return request<T>(url, { method: 'GET' });
}

export async function apiPost<T = unknown>(url: string, body?: unknown): Promise<T> {
  return request<T>(url, {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export async function apiPut<T = unknown>(url: string, body?: unknown): Promise<T> {
  return request<T>(url, {
    method: 'PUT',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export async function apiPatch<T = unknown>(url: string, body?: unknown): Promise<T> {
  return request<T>(url, {
    method: 'PATCH',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export async function apiDelete<T = unknown>(url: string): Promise<T> {
  return request<T>(url, { method: 'DELETE' });
}
