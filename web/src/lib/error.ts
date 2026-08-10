import { ApiErrorCode } from './api';

/**
 * 27 API error codes to Chinese UI toast / alert message mapping.
 * Keys are the string values of ApiErrorCode enum.
 */
export const ERROR_MESSAGES: Record<string, string> = {
  [ApiErrorCode.SESSION_NOT_FOUND]: '会话未找到',
  [ApiErrorCode.SESSION_EXPIRED]: '会话已过期',
  [ApiErrorCode.SESSION_LIMIT_EXCEEDED]: '会话数量超限',
  [ApiErrorCode.MESSAGE_NOT_FOUND]: '消息未找到',
  [ApiErrorCode.MESSAGE_TOO_LARGE]: '消息内容过长',
  [ApiErrorCode.STREAM_NOT_FOUND]: '流式响应未找到',
  [ApiErrorCode.STREAM_ALREADY_CLOSED]: '流式响应已关闭',
  [ApiErrorCode.AGENT_NOT_FOUND]: '智能体未找到',
  [ApiErrorCode.AGENT_UNAVAILABLE]: '智能体不可用',
  [ApiErrorCode.AGENT_RATE_LIMITED]: '智能体请求频率限制',
  [ApiErrorCode.PROVIDER_NOT_FOUND]: '模型供应商未找到',
  [ApiErrorCode.PROVIDER_UNAVAILABLE]: '模型供应商不可用',
  [ApiErrorCode.PROVIDER_AUTH_FAILED]: '供应商认证失败',
  [ApiErrorCode.PROVIDER_TIMEOUT]: '供应商响应超时',
  [ApiErrorCode.SKILL_NOT_FOUND]: '技能未找到',
  [ApiErrorCode.SKILL_EXECUTION_FAILED]: '技能执行失败',
  [ApiErrorCode.INVALID_REQUEST]: '无效请求',
  [ApiErrorCode.INVALID_PARAMETER]: '参数无效',
  [ApiErrorCode.MISSING_REQUIRED_FIELD]: '缺少必填字段',
  [ApiErrorCode.UNAUTHORIZED]: '未授权，请先登录',
  [ApiErrorCode.FORBIDDEN]: '无权限访问',
  [ApiErrorCode.TOKEN_EXPIRED]: 'Token 已过期，请重新登录',
  [ApiErrorCode.TOKEN_INVALID]: 'Token 无效',
  [ApiErrorCode.RATE_LIMIT_EXCEEDED]: '请求频率超限，请稍后重试',
  [ApiErrorCode.INTERNAL_ERROR]: '服务器内部错误',
  [ApiErrorCode.SERVICE_UNAVAILABLE]: '服务暂不可用',
  [ApiErrorCode.UPSTREAM_ERROR]: '上游服务错误',
};

/** Default error message used when the code is not in the map */
export const DEFAULT_ERROR_MESSAGE = '操作失败，请稍后重试';

/**
 * Look up the human-readable Chinese message for an API error code.
 * Falls back to `DEFAULT_ERROR_MESSAGE` for unknown codes.
 */
export function getErrorMessage(code: string): string {
  return ERROR_MESSAGES[code] || DEFAULT_ERROR_MESSAGE;
}
