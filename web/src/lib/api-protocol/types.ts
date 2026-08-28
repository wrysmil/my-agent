/**
 * RPC protocol core types.
 *
 * Four-quadrant discriminated union:
 *   ClientRequest  -> ServerResponse   (client-initiated request/response)
 *   ServerRequest  -> ClientResponse   (server-initiated request/response)
 */

// ─── RpcId ────────────────────────────────────────────────────────────────────

/**
 * Branded identifier that ties a request to its response.
 * Use {@link RpcId.mint} to create a new one; use {@link RpcId.from} to
 * rehydrate from the wire.
 */
export class RpcId {
  /** Readable label for debugging / logging. */
  readonly value: string;

  constructor(value: string) {
    this.value = value;
  }

  /** Generate a fresh RpcId (v4 UUID). */
  static mint(): RpcId {
    return new RpcId(crypto.randomUUID());
  }

  /** Rehydrate from a plain string received over the wire. */
  static from(value: string): RpcId {
    return new RpcId(value);
  }

  /** Type-guard: is `v` an RpcId instance? */
  static is(v: unknown): v is RpcId {
    return v instanceof RpcId;
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }
}

// ─── RpcResult ────────────────────────────────────────────────────────────────

/** Success result wrapper. */
export interface RpcOk<T> {
  ok: true;
  data: T;
}

/** Error result wrapper — mirrors backend ApiErrorCode shape. */
export interface RpcErr {
  ok: false;
  code: string;
  message?: string;
  details?: unknown;
}

/** Discriminated result: success or error. */
export type RpcResult<T> = RpcOk<T> | RpcErr;

// ─── Four-quadrant messages ───────────────────────────────────────────────────

/** Client -> Server: the client initiates a request. */
export interface ClientRequest {
  type: 'client-request';
  rpcId: RpcId;
  method: string;
  payload: unknown;
}

/** Server -> Client: the server replies to a ClientRequest. */
export interface ServerResponse {
  type: 'server-response';
  rpcId: RpcId;
  result: RpcResult<unknown>;
}

/** Server -> Client: the server initiates a request (e.g. approval). */
export interface ServerRequest {
  type: 'server-request';
  rpcId: RpcId;
  method: string;
  payload: unknown;
}

/** Client -> Server: the client replies to a ServerRequest. */
export interface ClientResponse {
  type: 'client-response';
  rpcId: RpcId;
  result: RpcResult<unknown>;
}

/** Top-level discriminated union of all RPC messages. */
export type RpcMessage =
  | ClientRequest
  | ServerResponse
  | ServerRequest
  | ClientResponse;
