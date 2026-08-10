/**
 * my-agent Web 前端 — 统一错误处理层单测（WU-02e / B7）。
 *
 * 覆盖范围（contract § 3 + spec § 3.4 + done criteria #6）：
 * - ApiErrorCode 22 个 code 全部存在
 * - ERROR_STATUS_MAP 22 行（每个 code 都有）
 * - ApiError 构造 / status 自动取自 map / cause 传递
 * - toApiErrorBody 接收 ApiError / 普通 Error / ZodError / string / null
 * - handleError 写正确 status + Content-Type + body shape
 * - handleError 在 logger 注入时记录 warn
 * - JSON 形状校验（包含 details / message / requestId）
 * - zodErrorToApiError 适配器
 */

import { describe, it, expect, vi } from "vitest";

import {
  ApiErrorCode,
  ERROR_STATUS_MAP,
  ApiError,
  handleError,
  toApiErrorBody,
  zodErrorToApiError,
  type ApiErrorCodeValue,
} from "./errors.js";
import type { Logger } from "../../shared/logger.js";

// ============================================================
// ① ApiErrorCode 枚举完整性（contract § 3 全部 22 个 code）
// ============================================================

describe("ApiErrorCode 枚举", () => {
  const EXPECTED_CODES: ReadonlyArray<[ApiErrorCodeValue, number]> = [
    // 通用
    [ApiErrorCode.INVALID_JSON, 400],
    [ApiErrorCode.VALIDATION_FAILED, 422],
    [ApiErrorCode.NOT_FOUND, 404],
    [ApiErrorCode.METHOD_NOT_ALLOWED, 405],
    [ApiErrorCode.PAYLOAD_TOO_LARGE, 413],
    [ApiErrorCode.RATE_LIMITED, 429],
    [ApiErrorCode.INTERNAL, 500],
    // Provider 域
    [ApiErrorCode.PROVIDER_NOT_FOUND, 404],
    [ApiErrorCode.PROVIDER_DUPLICATE_ID, 409],
    [ApiErrorCode.PROVIDER_INVALID_BASE_URL, 422],
    [ApiErrorCode.PROVIDER_INVALID_TYPE, 422],
    [ApiErrorCode.PROVIDER_API_KEY_EMPTY, 422],
    [ApiErrorCode.PROVIDER_ACTIVE_NOT_DELETABLE, 409],
    [ApiErrorCode.PROVIDER_ALREADY_EXISTS, 409],
    [ApiErrorCode.MODEL_NOT_FOUND, 404],
    // Session 域
    [ApiErrorCode.SESSION_NOT_FOUND, 404],
    [ApiErrorCode.SESSION_ALREADY_EXISTS, 409],
    [ApiErrorCode.SESSION_CORRUPT_FILE, 500],
    // Chat 域
    [ApiErrorCode.CHAT_SESSION_BUSY, 429],
    [ApiErrorCode.CHAT_ABORTED, 200],
    [ApiErrorCode.CHAT_RUNNER_ERROR, 500],
    [ApiErrorCode.CHAT_INVALID_EVENT, 500],
    [ApiErrorCode.STREAM_ALREADY_RUNNING, 409],
    [ApiErrorCode.STREAM_NOT_FOUND, 404],
    // Agent / Skill 域
    [ApiErrorCode.AGENT_NOT_FOUND, 404],
    [ApiErrorCode.AGENT_SPEC_INVALID_JSON, 500],
    [ApiErrorCode.SKILL_NOT_FOUND, 404],
  ];

  it("导出 27 个 code（与 contract § 3 严格一致）", () => {
    // 7 通用 + 8 Provider + 3 Session + 6 Chat + 3 Agent/Skill = 27
    const codes = Object.values(ApiErrorCode);
    expect(codes.length).toBe(27);
  });

  it("27 个 code 全部在 ERROR_STATUS_MAP 内有映射", () => {
    const codes = Object.values(ApiErrorCode);
    for (const code of codes) {
      expect(ERROR_STATUS_MAP[code]).toBeTypeOf("number");
    }
  });

  it.each(EXPECTED_CODES)(
    "%s → %i",
    (code, expectedStatus) => {
      expect(ERROR_STATUS_MAP[code]).toBe(expectedStatus);
    },
  );
});

// ============================================================
// ② ERROR_STATUS_MAP 形状校验
// ============================================================

describe("ERROR_STATUS_MAP", () => {
  it("恰好 27 行（与 ApiErrorCode 数量一致）", () => {
    expect(Object.keys(ERROR_STATUS_MAP).length).toBe(27);
  });

  it("每个 status 都是合法 HTTP code（100-599）", () => {
    for (const [code, status] of Object.entries(ERROR_STATUS_MAP)) {
      expect(Number.isInteger(status)).toBe(true);
      expect(status).toBeGreaterThanOrEqual(100);
      expect(status).toBeLessThan(600);
      // 用于测试时定位 row
      expect(code).toBeTruthy();
    }
  });

  it("CHAT_ABORTED 特殊：status = 200（abort 不是错误）", () => {
    expect(ERROR_STATUS_MAP[ApiErrorCode.CHAT_ABORTED]).toBe(200);
  });
});

// ============================================================
// ③ ApiError 类
// ============================================================

describe("ApiError", () => {
  it("构造后 code / status / message 字段正确", () => {
    const err = new ApiError(
      ApiErrorCode.PROVIDER_NOT_FOUND,
      "Provider deepseek not found",
    );
    expect(err.code).toBe("PROVIDER_NOT_FOUND");
    expect(err.status).toBe(404);
    expect(err.message).toBe("Provider deepseek not found");
    expect(err.name).toBe("ApiError");
    expect(err.details).toBeUndefined();
    expect(err.cause).toBeUndefined();
  });

  it("message 缺省时回退到 code", () => {
    const err = new ApiError(ApiErrorCode.INTERNAL);
    expect(err.message).toBe("INTERNAL");
    expect(err.code).toBe("INTERNAL");
    expect(err.status).toBe(500);
  });

  it("status 字段从 map 自动查得（不应被手动覆盖）", () => {
    // 即使业务传错也不生效 —— status 永远是 map 查得
    const err = new ApiError(ApiErrorCode.PAYLOAD_TOO_LARGE, "too big");
    expect(err.status).toBe(413);
  });

  it("details 与 cause 字段正确传递", () => {
    const cause = new Error("original");
    const err = new ApiError(
      ApiErrorCode.INTERNAL,
      "wrapped",
      { field: "x", hint: "required" },
      cause,
    );
    expect(err.details).toEqual({ field: "x", hint: "required" });
    expect(err.cause).toBe(cause);
    // ES2022 Error cause 链可读
    expect((err as Error & { cause?: unknown }).cause).toBe(cause);
  });

  it("toBodyWithoutRequestId 返回 ApiErrorBody 形状（无 requestId）", () => {
    const err = new ApiError(
      ApiErrorCode.PROVIDER_DUPLICATE_ID,
      "dup",
      { field: "id" },
    );
    const partial = err.toBodyWithoutRequestId();
    expect(partial.ok).toBe(false);
    expect(partial.error.code).toBe("PROVIDER_DUPLICATE_ID");
    expect(partial.error.message).toBe("dup");
    expect(partial.error.details).toEqual({ field: "id" });
    // 不应包含 requestId
    expect("requestId" in partial.error).toBe(false);
  });

  it("instanceof 双向成立（Error ↔ ApiError）", () => {
    const err = new ApiError(ApiErrorCode.INTERNAL);
    expect(err instanceof ApiError).toBe(true);
    expect(err instanceof Error).toBe(true);
    // 反向：普通 Error 不是 ApiError
    const plain = new Error("x");
    expect(plain instanceof ApiError).toBe(false);
  });

  it("可用作 throw —— catch 后保留所有字段", () => {
    try {
      throw new ApiError(
        ApiErrorCode.MODEL_NOT_FOUND,
        "model gpt-x not in registry",
      );
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(ApiError);
      if (e instanceof ApiError) {
        expect(e.code).toBe("MODEL_NOT_FOUND");
        expect(e.status).toBe(404);
      }
    }
  });
});

// ============================================================
// ④ toApiErrorBody —— 任意 unknown → ApiErrorBody
// ============================================================

describe("toApiErrorBody", () => {
  it("ApiError → 透传 code / status / message / details + 注入 requestId", () => {
    const err = new ApiError(
      ApiErrorCode.PROVIDER_DUPLICATE_ID,
      "Duplicate id: deepseek",
      { id: "deepseek" },
    );
    const body = toApiErrorBody(err, "req_abc123");
    expect(body).toEqual({
      ok: false,
      error: {
        code: "PROVIDER_DUPLICATE_ID",
        message: "Duplicate id: deepseek",
        requestId: "req_abc123",
        details: { id: "deepseek" },
      },
    });
  });

  it("普通 Error → INTERNAL (500) + err.message", () => {
    const body = toApiErrorBody(new Error("disk full"), "req_xyz");
    expect(body).toEqual({
      ok: false,
      error: {
        code: "INTERNAL",
        message: "disk full",
        requestId: "req_xyz",
      },
    });
  });

  it("Error.message 为空时回退 'Internal Server Error'", () => {
    const body = toApiErrorBody(new Error(""), "req_q");
    expect(body.error.message).toBe("Internal Server Error");
    expect(body.error.code).toBe("INTERNAL");
  });

  it("string err → INTERNAL (500) + 原 string 作为 message", () => {
    const body = toApiErrorBody("weird failure", "req_s");
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.message).toBe("weird failure");
  });

  it("null / undefined / number 等 → INTERNAL (500)", () => {
    for (const v of [null, undefined, 42, {}]) {
      const body = toApiErrorBody(v, "req_x");
      expect(body.error.code).toBe("INTERNAL");
      expect(body.error.message).toBeTruthy();
      expect(body.error.requestId).toBe("req_x");
    }
  });

  it("Zod 形状的 err → INVALID_JSON (400) + details.issues", () => {
    const zodLike = {
      issues: [
        {
          code: "invalid_type",
          path: ["name"],
          message: "Expected string, received undefined",
        },
      ],
    };
    const body = toApiErrorBody(zodLike, "req_z");
    expect(body.error.code).toBe("INVALID_JSON");
    expect(body.error.message).toBe("Invalid input");
    expect(body.error.details).toEqual({ issues: zodLike.issues });
    expect(body.error.requestId).toBe("req_z");
  });

  it("ApiError.details 缺省时不出现在 body 内（避免空字段）", () => {
    const body = toApiErrorBody(
      new ApiError(ApiErrorCode.PROVIDER_NOT_FOUND, "not found"),
      "req_d",
    );
    expect(Object.prototype.hasOwnProperty.call(body.error, "details")).toBe(
      false,
    );
  });
});

// ============================================================
// ⑤ handleError —— 写 res
// ============================================================

describe("handleError", () => {
  /**
   * 创建 mock ServerResponse；返回所有 capture 的字段。
   */
  function mockRes(): {
    res: import("node:http").ServerResponse;
    headers: Record<string, string>;
    statusCode: () => number;
    body: () => string;
  } {
    const headers: Record<string, string> = {};
    let sc = 0;
    let bodyStr = "";
    const res = {
      statusCode: 0,
      setHeader: (k: string, v: string): typeof res => {
        headers[k.toLowerCase()] = v;
        return res;
      },
      getHeader: (k: string): string | undefined => headers[k.toLowerCase()],
      end: (chunk?: string | Buffer): typeof res => {
        bodyStr = typeof chunk === "string" ? chunk : chunk?.toString() ?? "";
        return res;
      },
      get capturedStatus(): number {
        return sc;
      },
    } as unknown as import("node:http").ServerResponse;

    // 拦截 statusCode 写入
    Object.defineProperty(res, "statusCode", {
      get() {
        return sc;
      },
      set(v: number) {
        sc = v;
      },
    });

    return {
      res,
      headers,
      statusCode: () => sc,
      body: () => bodyStr,
    };
  }

  it("ApiError → 写正确 statusCode + Content-Type + ApiErrorBody 形状", () => {
    const m = mockRes();
    handleError(
      new ApiError(ApiErrorCode.PROVIDER_NOT_FOUND, "deepseek missing"),
      m.res,
      { requestId: "req_handle_1" },
    );
    expect(m.statusCode()).toBe(404);
    expect(m.headers["content-type"]).toBe(
      "application/json; charset=utf-8",
    );
    const body = JSON.parse(m.body()) as {
      ok: boolean;
      error: { code: string; message: string; requestId: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("PROVIDER_NOT_FOUND");
    expect(body.error.message).toBe("deepseek missing");
    expect(body.error.requestId).toBe("req_handle_1");
  });

  it("ZodError 形状 → 400 + details.issues 透传", () => {
    const m = mockRes();
    handleError(
      { issues: [{ code: "too_small", path: ["n"], message: "x" }] },
      m.res,
      { requestId: "req_zod" },
    );
    expect(m.statusCode()).toBe(400);
    const body = JSON.parse(m.body()) as { error: { code: string; details?: { issues: unknown } } };
    expect(body.error.code).toBe("INVALID_JSON");
    expect(body.error.details).toEqual({ issues: [{ code: "too_small", path: ["n"], message: "x" }] });
  });

  it("普通 Error → 500 + INTERNAL", () => {
    const m = mockRes();
    handleError(new Error("oops"), m.res, { requestId: "req_e" });
    expect(m.statusCode()).toBe(500);
    const body = JSON.parse(m.body());
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.message).toBe("oops");
    expect(body.error.requestId).toBe("req_e");
  });

  it("logger 注入时调用 logger.warn 一次", () => {
    const m = mockRes();
    const warn = vi.fn();
    const log: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn,
      error: vi.fn(),
      child: () => log,
    };
    handleError(
      new ApiError(ApiErrorCode.RATE_LIMITED, "slow down"),
      m.res,
      { requestId: "req_log", logger: log },
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("429");
    expect(warn.mock.calls[0]?.[0]).toContain("RATE_LIMITED");
  });

  it("logger 缺省时不调用任何 logger（不抛错）", () => {
    const m = mockRes();
    expect(() =>
      handleError(
        new ApiError(ApiErrorCode.INTERNAL, "x"),
        m.res,
        { requestId: "req_nolog" },
      ),
    ).not.toThrow();
    expect(m.statusCode()).toBe(500);
  });

  it("ApiError Body 序列化包含 details（不丢失 Zod issues）", () => {
    const m = mockRes();
    const err = new ApiError(
      ApiErrorCode.PROVIDER_INVALID_BASE_URL,
      "must start with http(s)",
      { field: "baseUrl", expected: "/^https?:\\/\\//" },
    );
    handleError(err, m.res, { requestId: "req_b" });
    const body = JSON.parse(m.body()) as { error: { details?: { field: string } } };
    expect(body.error.details?.field).toBe("baseUrl");
  });

  it("Content-Type 总是 application/json; charset=utf-8", () => {
    const m = mockRes();
    handleError(new ApiError(ApiErrorCode.NOT_FOUND, "x"), m.res, { requestId: "r" });
    expect(m.headers["content-type"]).toBe(
      "application/json; charset=utf-8",
    );
  });
});

// ============================================================
// ⑥ zodErrorToApiError
// ============================================================

describe("zodErrorToApiError", () => {
  it("Zod 形状 err → ApiError(INVALID_JSON, 'Invalid input', {issues})", () => {
    const issues = [
      { code: "invalid_type", path: ["email"], message: "must be string" },
    ];
    const apiErr = zodErrorToApiError({ issues });
    expect(apiErr).toBeInstanceOf(ApiError);
    expect(apiErr.code).toBe("INVALID_JSON");
    expect(apiErr.status).toBe(400);
    expect(apiErr.message).toBe("Invalid input");
    expect(apiErr.details).toEqual({ issues });
  });

  it("非 Zod 形状 err → 兜底 ApiError(INTERNAL)", () => {
    const apiErr = zodErrorToApiError("not a zod err");
    expect(apiErr.code).toBe("INTERNAL");
    expect(apiErr.status).toBe(500);
    // cause 是原始值
    expect(apiErr.cause).toBe("not a zod err");
  });
});

// ============================================================
// ⑦ JSON 形状深度校验
// ============================================================

describe("ApiErrorBody / ApiSuccess JSON 形状", () => {
  it("ApiError 序列化后含 ok=false / error.{code, message, requestId}", () => {
    const body = toApiErrorBody(
      new ApiError(ApiErrorCode.SESSION_NOT_FOUND, "sid missing"),
      "req_shape",
    );
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("SESSION_NOT_FOUND");
    expect(body.error.message).toBe("sid missing");
    expect(body.error.requestId).toBe("req_shape");
    expect(Object.keys(body)).toEqual(["ok", "error"]);
  });

  it("ApiError 含 details 时序列化保留 details 字段", () => {
    const body = toApiErrorBody(
      new ApiError(
        ApiErrorCode.PROVIDER_DUPLICATE_ID,
        "duplicate",
        { id: "deepseek", count: 2 },
      ),
      "req_det",
    );
    expect(body.error.details).toEqual({ id: "deepseek", count: 2 });
  });
});
