/**
 * 运行时上下文注入工具。
 *
 * 用于在 system prompt 尾部注入当前日期和时区信息。
 * 移植自 Orkas `src/main/prompts/runtime_context.ts`。
 */

// ============================================================
// 内部辅助
// ============================================================

/** 两位数补零 */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** UTC 偏移量格式化（±HH:MM） */
function formatOffset(minutesBehindUtc: number): string {
  const total = -minutesBehindUtc;
  const sign = total >= 0 ? "+" : "-";
  const abs = Math.abs(total);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return `${sign}${pad2(hours)}:${pad2(minutes)}`;
}

// ============================================================
// 公开 API
// ============================================================

/**
 * 格式化当前日期为 `YYYY-MM-DD`。
 *
 * @param date — 要格式化的日期，不传则使用当前时刻
 * @returns 格式化后的日期字符串
 *
 * @example
 * ```ts
 * formatCurrentDate(); // → "2026-08-02"
 * formatCurrentDate(new Date("2026-12-25")); // → "2026-12-25"
 * ```
 */
export function formatCurrentDate(date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * 获取运行时所在的 IANA 时区标识符。
 *
 * 优先使用 `Intl.DateTimeFormat` 解析，fallback 为 UTC 偏移量。
 *
 * @returns 时区标识符，如 `"Asia/Shanghai"` 或 `"UTC+08:00"`
 *
 * @example
 * ```ts
 * getRuntimeTimezone(); // → "Asia/Shanghai"
 * ```
 */
export function getRuntimeTimezone(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return tz || `UTC${formatOffset(new Date().getTimezoneOffset())}`;
}

/**
 * 构建运行时日期时间块，注入到 system prompt 尾部。
 *
 * 生成如下格式的文本：
 * ```
 * ## Current date
 *
 * Timezone: Asia/Shanghai
 * Current date: 2026-08-02
 * ```
 *
 * @param date — 要使用的日期，不传则使用当前时刻
 * @returns 完整的日期时间块文本
 *
 * @example
 * ```ts
 * const block = buildRuntimeDatetimeBlock();
 * // 追加到 system prompt 或 turnEphemeral
 * ```
 */
export function buildRuntimeDatetimeBlock(date: Date = new Date()): string {
  const currentDate = formatCurrentDate(date);
  return [
    "## Current date",
    "",
    `Timezone: ${getRuntimeTimezone()}`,
    `Current date: ${currentDate}`,
  ].join("\n");
}
