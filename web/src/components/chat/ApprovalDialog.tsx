/**
 * ApprovalDialog — 工具执行审批弹窗。
 *
 * 触发时机：收到 approval/requested 帧
 * 设计：
 * - 模态弹窗，阻止其他交互
 * - 显示工具名称、参数、风险提示
 * - 允许 / 拒绝 / 查看详情 操作
 */

import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  ShieldAlert,
  X,
} from 'lucide-react';

export interface ApprovalDialogProps {
  /** 工具名称 */
  toolName: string;
  /** 工具参数 */
  payload: Record<string, unknown>;
  /** 审批理由/风险提示 */
  reason?: string;
  /** 超时倒计时（秒），0 表示不显示 */
  timeoutSeconds?: number;
  /** 审批回调 */
  onApprove: () => void;
  onReject: (reason?: string) => void;
  /** 是否正在处理（防止重复点击） */
  pending?: boolean;
}

export function ApprovalDialog({
  toolName,
  payload,
  reason,
  timeoutSeconds = 300,
  onApprove,
  onReject,
  pending = false,
}: ApprovalDialogProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const payloadJson = JSON.stringify(payload, null, 2);
  const hasHighRisk = isHighRiskTool(toolName, payload);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="approval-dialog-title"
    >
      <div className="relative w-full max-w-lg mx-4 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
              hasHighRisk
                ? 'bg-danger/10 text-danger'
                : 'bg-amber-500/10 text-amber-600'
            }`}
          >
            {hasHighRisk ? (
              <ShieldAlert size={20} />
            ) : (
              <AlertTriangle size={20} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h2
              id="approval-dialog-title"
              className="text-base font-semibold text-text truncate"
            >
              工具执行审批
            </h2>
            <p className="text-sm text-text-muted truncate">
              {toolName}
            </p>
          </div>
          {!pending && (
            <button
              onClick={() => onReject('dismissed')}
              className="shrink-0 p-2 rounded-lg hover:bg-surface-hover transition-colors"
              aria-label="关闭"
            >
              <X size={18} className="text-text-muted" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* 风险提示 */}
          {hasHighRisk && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-danger/5 border border-danger/20">
              <AlertTriangle
                size={16}
                className="shrink-0 mt-0.5 text-danger"
              />
              <div className="text-sm text-danger">
                <p className="font-medium">高风险操作</p>
                {reason && <p className="mt-1 text-danger/80">{reason}</p>}
              </div>
            </div>
          )}

          {/* 工具参数 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-text">
                参数详情
              </label>
              <button
                onClick={() => setShowDetails((v) => !v)}
                className="flex items-center gap-1 text-sm text-primary hover:text-primary/80 transition-colors"
              >
                {showDetails ? <EyeOff size={14} /> : <Eye size={14} />}
                {showDetails ? '隐藏' : '显示'}
              </button>
            </div>

            {showDetails ? (
              <div className="relative">
                <pre className="p-3 rounded-lg bg-surface-hover text-xs font-mono overflow-auto max-h-48">
                  {payloadJson}
                </pre>
                <button
                  onClick={() => navigator.clipboard.writeText(payloadJson)}
                  className="absolute top-2 right-2 p-1.5 rounded bg-white/80 dark:bg-gray-700/80 hover:bg-white dark:hover:bg-gray-700 transition-colors"
                  aria-label="复制参数"
                >
                  <Copy size={14} className="text-text-muted" />
                </button>
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-surface-hover text-sm text-text-muted">
                点击「显示」查看完整参数
              </div>
            )}
          </div>

          {/* 拒绝原因（可选） */}
          {rejectReason && (
            <div>
              <label className="text-sm font-medium text-text mb-1.5 block">
                拒绝原因（可选）
              </label>
              <input
                type="text"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="为什么不拒绝？"
                className="w-full px-3 py-2 rounded-lg border border-border bg-white dark:bg-gray-900 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-border bg-surface-hover/50">
          {timeoutSeconds > 0 && (
            <div className="mr-auto text-sm text-text-muted flex items-center gap-1.5">
              <Loader2 size={14} className="animate-spin" />
              <span>
                {Math.floor(timeoutSeconds / 60)}:
                {String(timeoutSeconds % 60).padStart(2, '0')} 后自动拒绝
              </span>
            </div>
          )}

          <button
            onClick={() => onReject(rejectReason || undefined)}
            disabled={pending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-text hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <X size={16} />
            拒绝
          </button>

          <button
            onClick={onApprove}
            disabled={pending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Check size={16} />
            )}
            {pending ? '处理中…' : '允许执行'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 判断是否为高风险工具。
 * 规则：
 * - 删除类命令（rm, del, rmdir）
 * - 系统修改（shutdown, reboot, chmod, chown）
 * - 网络请求（curl, wget, fetch）需额外确认
 */
function isHighRiskTool(
  toolName: string,
  payload: Record<string, unknown>,
): boolean {
  const highRiskTools = [
    'rm',
    'rmdir',
    'del',
    'delete',
    'shutdown',
    'reboot',
    'chmod',
    'chown',
    'sudo',
    'kill',
  ];
  const name = toolName.toLowerCase();

  if (highRiskTools.some((t) => name.includes(t))) {
    return true;
  }

  // curl/wget 带 -X DELETE 或敏感 URL
  if (name.includes('curl') || name.includes('wget')) {
    const url = String(payload.url || payload.uri || '');
    if (
      url.includes('delete') ||
      url.includes('destroy') ||
      url.includes('admin')
    ) {
      return true;
    }
  }

  return false;
}
