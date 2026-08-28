import { RpcErrorCode, normalizeErrorCode } from './api-protocol/errors';

/**
 * 27 API error codes to Chinese UI toast / alert message mapping.
 * Keys are the kebab-case RpcErrorCode values.
 */
export const ERROR_MESSAGES: Record<RpcErrorCode, string> = {
  'session-not-found': '会话未找到',
  'session-expired': '会话已过期',
  'session-limit-exceeded': '会话数量超限',
  'message-not-found': '消息未找到',
  'message-too-large': '消息内容过长',
  'stream-not-found': '流式响应未找到',
  'stream-already-closed': '流式响应已关闭',
  'agent-not-found': '智能体未找到',
  'agent-unavailable': '智能体不可用',
  'agent-rate-limited': '智能体请求频率限制',
  'provider-not-found': '模型供应商未找到',
  'provider-unavailable': '模型供应商不可用',
  'provider-auth-failed': '供应商认证失败',
  'provider-timeout': '供应商响应超时',
  'skill-not-found': '技能未找到',
  'skill-execution-failed': '技能执行失败',
  'invalid-request': '无效请求',
  'invalid-parameter': '参数无效',
  'missing-required-field': '缺少必填字段',
  'unauthorized': '未授权，请先登录',
  'forbidden': '无权限访问',
  'token-expired': 'Token 已过期，请重新登录',
  'token-invalid': 'Token 无效',
  'rate-limit-exceeded': '请求频率超限，请稍后重试',
  'internal-error': '服务器内部错误',
  'service-unavailable': '服务暂不可用',
  'upstream-error': '上游服务错误',
};

/** Default error message used when the code is not in the map */
export const DEFAULT_ERROR_MESSAGE = '操作失败，请稍后重试';

/**
 * Look up the human-readable Chinese message for an API error code.
 * Falls back to `DEFAULT_ERROR_MESSAGE` for unknown codes.
 * Supports both legacy SCREAMING_SNAKE_CASE and new kebab-case codes.
 */
export function getErrorMessage(code: string): string {
  const normalizedCode = normalizeErrorCode(code);
  return ERROR_MESSAGES[normalizedCode] || DEFAULT_ERROR_MESSAGE;
}
