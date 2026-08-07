/**
 * api.js — fetch wrapper + ApiClientError（F3 / WU-04a）
 *
 * 设计约束：
 * - 零依赖：纯 fetch + AbortController；不引 axios / ky / undici。
 * - 与 src/web/server/errors.ts 同源错误壳：
 *     成功：{ ok: true, data }
 *     失败：{ ok: false, error: { code, message, details?, requestId } }
 *   任何偏离 → 视为协议错误（PROTOCOL_ERROR）。
 *
 * 职责：
 *   apiFetch(path, opts)
 *     - 默认 base = 当前 origin + path（同源部署）
 *     - method/body/signal/headers 参数化
 *     - 非 2xx → throw ApiClientError（code 取 body.error.code）
 *     - body 是 object（除 GET 外）→ 自动 JSON.stringify + Content-Type
 *     - 支持 AbortSignal 中断
 *
 *   ApiClientError
 *     - code / message / details / status 字段
 *     - toString() / toJSON() 给 UI 层展示用
 *
 *   ApiClientErrorCode
 *     - NETWORK_ERROR（fetch reject / DNS 失败）
 *     - ABORTED（用户主动取消）
 *     - PROTOCOL_ERROR（响应不是 JSON / 缺 ok 字段）
 *     - HTTP_ERROR（非 2xx 且无法解析成 ApiErrorBody 时兜底）
 *
 * 与其他模块的协作：
 *   - utils.js 已先加载（提供 assert / escapeHtml 等，不强依赖）
 *   - 不依赖 i18n / theme / icons
 */

(function (global) {
  'use strict';

  // ------------------------------------------------------------------
  // ApiClientErrorCode — 客户端侧错误码枚举
  // ------------------------------------------------------------------

  var ApiClientErrorCode = {
    NETWORK_ERROR: 'NETWORK_ERROR',
    ABORTED: 'ABORTED',
    PROTOCOL_ERROR: 'PROTOCOL_ERROR',
    HTTP_ERROR: 'HTTP_ERROR',
  };

  // ------------------------------------------------------------------
  // ApiClientError class
  // ------------------------------------------------------------------

  /**
   * 统一 API 客户端错误（与 src/web/server/errors.ts 的 ApiError 对称）。
   *
   * 字段：
   *   code     — ApiClientErrorCode 之一，或服务端 ApiErrorCode（透传）
   *   message  — 人可读文案
   *   details  — 字段级详情（透传服务端 details）
   *   status   — HTTP 状态码（缺省 = 0 表示客户端侧错误）
   *
   * cause 走 Error.cause（标准 ES2022）。
   *
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>=} details
   * @param {number=} status
   * @param {Error=} cause
   */
  function ApiClientError(code, message, details, status, cause) {
    var opts = cause !== undefined ? { cause: cause } : undefined;
    var msg = message || code || 'ApiClientError';
    var err = new Error(msg, opts);
    // 让 instanceof 在 extends Error + ES2023 下工作
    Object.setPrototypeOf(err, ApiClientError.prototype);
    err.name = 'ApiClientError';
    err.code = code;
    err.details = details;
    err.status = typeof status === 'number' ? status : 0;
    return err;
  }

  ApiClientError.prototype = Object.create(Error.prototype);
  ApiClientError.prototype.constructor = ApiClientError;

  /**
   * 给 UI 层用：稳定可读的字符串（不暴露堆栈）。
   * @returns {string}
   */
  ApiClientError.prototype.toString = function toString() {
    return 'ApiClientError[' + this.code + ' ' + this.status + ']: ' + this.message;
  };

  /**
   * 给 JSON.stringify / ErrorBoundary 序列化用。
   * @returns {{name:string,code:string,message:string,status:number,details?:Record<string,unknown>}}
   */
  ApiClientError.prototype.toJSON = function toJSON() {
    var out = {
      name: this.name,
      code: this.code,
      message: this.message,
      status: this.status,
    };
    if (this.details !== undefined) out.details = this.details;
    return out;
  };

  // ------------------------------------------------------------------
  // apiFetch(path, opts) — 调 fetch + 协议校验
  // ------------------------------------------------------------------

  /**
   * 调 fetch，按 spec § 3.4 的 {ok,data}/{ok,error} 协议解析响应。
   *
   * opts：
   *   method  — 缺省 'GET'
   *   body    — object / string / null；object → 自动 JSON.stringify + Content-Type
   *   signal  — AbortSignal；触发时抛 ApiClientError(ABORTED)
   *   headers — 额外请求头（object）
   *   base    — 缺省 = 当前 origin（window.location.origin）；测试时可注入
   *
   * 行为：
   *   - 非 2xx → throw ApiClientError(code 取 body.error.code；status = response.status)
   *   - 响应不是 JSON / 缺 ok 字段 → throw ApiClientError(PROTOCOL_ERROR, status)
   *   - fetch reject（网络错） → throw ApiClientError(NETWORK_ERROR)
   *   - AbortSignal 触发 → throw ApiClientError(ABORTED)（原 AbortError 走 cause）
   *
   * @param {string} path
   * @param {{
   *   method?: string,
   *   body?: any,
   *   signal?: AbortSignal,
   *   headers?: Record<string, string>,
   *   base?: string,
   * }=} opts
   * @returns {Promise<any>} 返回 data 字段（去掉 ok 外壳）
   */
  function apiFetch(path, opts) {
    opts = opts || {};
    var method = (opts.method || 'GET').toUpperCase();
    var body = opts.body;
    var signal = opts.signal || null;
    var extraHeaders = opts.headers || {};
    var base = opts.base || (global.location && global.location.origin) || '';

    var headers = Object.assign({}, extraHeaders);
    var payload = null;
    if (body !== null && body !== undefined) {
      if (typeof body === 'string') {
        // 已是字符串：原样发；让调用方自己设 Content-Type
        payload = body;
      } else {
        // object/array：自动 JSON
        if (!hasHeader(headers, 'Content-Type')) {
          headers['Content-Type'] = 'application/json; charset=utf-8';
        }
        payload = JSON.stringify(body);
      }
    }

    var url = joinUrl(base, path);

    var fetchInit = {
      method: method,
      headers: headers,
    };
    if (signal) fetchInit.signal = signal;
    if (payload !== null) fetchInit.body = payload;

    return fetch(url, fetchInit).then(
      function onFulfilled(response) {
        return parseResponse(response);
      },
      function onRejected(err) {
        // AbortSignal 触发 → 原生抛 AbortError（name='AbortError'）
        if (err && (err.name === 'AbortError' || err.code === 20 /* DOMException.ABORT_ERR */)) {
          throw new ApiClientError(
            ApiClientErrorCode.ABORTED,
            'Request aborted',
            undefined,
            0,
            err,
          );
        }
        throw new ApiClientError(
          ApiClientErrorCode.NETWORK_ERROR,
          (err && err.message) || 'Network error',
          undefined,
          0,
          err,
        );
      },
    );
  }

  /**
   * 解析 Response → data 或 throw ApiClientError。
   * 提取出来便于单测覆盖。
   *
   * @param {Response} response
   * @returns {Promise<any>}
   */
  function parseResponse(response) {
    var status = response.status;

    return response.text().then(function onText(raw) {
      var body = null;
      if (raw && raw.length > 0) {
        try {
          body = JSON.parse(raw);
        } catch (_e) {
          // 响应不是 JSON：协议错误
          throw new ApiClientError(
            ApiClientErrorCode.PROTOCOL_ERROR,
            'Response is not valid JSON (status ' + status + ')',
            undefined,
            status,
          );
        }
      }

      // 2xx → 必须有 ok:true + data
      if (status >= 200 && status < 300) {
        if (!body || body.ok !== true || !('data' in body)) {
          throw new ApiClientError(
            ApiClientErrorCode.PROTOCOL_ERROR,
            'Missing { ok: true, data } envelope (status ' + status + ')',
            undefined,
            status,
          );
        }
        return body.data;
      }

      // 非 2xx：尝试读 { ok:false, error:{code,message,details?} }
      if (body && body.ok === false && body.error && typeof body.error === 'object') {
        var e = body.error;
        throw new ApiClientError(
          e.code || ApiClientErrorCode.HTTP_ERROR,
          e.message || ('HTTP ' + status),
          e.details,
          status,
        );
      }

      // 非 2xx 且响应体不可解析：兜底 HTTP_ERROR
      throw new ApiClientError(
        ApiClientErrorCode.HTTP_ERROR,
        'HTTP ' + status,
        undefined,
        status,
      );
    });
  }

  // ------------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------------

  function hasHeader(headers, name) {
    var lower = name.toLowerCase();
    var keys = Object.keys(headers);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === lower) return true;
    }
    return false;
  }

  function joinUrl(base, path) {
    if (!base) return path;
    if (path.charAt(0) === '/') return base + path;
    return base + '/' + path;
  }

  // ------------------------------------------------------------------
  // 导出
  // ------------------------------------------------------------------

  global.MyAgent = global.MyAgent || {};
  global.MyAgent.api = {
    apiFetch: apiFetch,
    ApiClientError: ApiClientError,
    ApiClientErrorCode: ApiClientErrorCode,
    // 内部 helper 暴露，便于单测：
    _parseResponse: parseResponse,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);