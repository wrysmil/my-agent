/**
 * Composer — 改造版，支持附件 / 上下文下拉 / 草稿区。
 *
 * 来源：spec § 5 .ai-runtime-artifacts/specs/2026-08-09-chat-composer-redesign-spec.md
 * 落地：plan § Step 2.3 → W2-WU-02 Orkas 优化
 *
 * 变化要点：
 *   1. IME 组合态守卫：Enter 键在 composition 期间不发送（中文输入法兼容）
 *   2. 输入区域卡片化（Orkas 风格）：max-w:80% 居中、圆角、阴影、focus-within 态
 *   3. 底部栏重组：[+] | divider | To | Workspace | spacer | send/stop icon
 *   4. send/stop 改为纯图标按钮（32x32），匹配 Orkas .chat-send-btn
 *   5. onSend 签名扩展为 (text: string, attachments: AttachmentDraft[]) => void
 */

import { useState, useRef, useEffect, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Send, Square, AlertCircle } from 'lucide-react';
import { AttachmentList } from './AttachmentList';
import { ComposerAttachmentButton } from './ComposerAttachmentButton';
import { ContextDropdown, type DropdownOption } from './ContextDropdown';
import {
  validateAttachments,
  type AttachmentDraft,
  type ValidationFailure,
} from '@/features/attachments/validateAttachment';
import { useTranslation } from '@/i18n/useTranslation';
import type { ChatStatus } from '@/features/chat/types';

export interface ComposerProps {
  onSend: (text: string, attachments: AttachmentDraft[]) => void;
  onAbort: () => void;
  status: ChatStatus;
  /** 顶部一行（模型选择 + 思考级别），由 ChatPage 注入 */
  modelSelector?: ReactNode;
  /** 「给：xxx」选项 */
  toOptions: readonly DropdownOption[];
  /** 「工作区：xxx」选项 */
  workspaceOptions: readonly DropdownOption[];
  /** 受控值：当前选中的「给」id */
  toValue: string;
  /** 受控值：当前选中的「工作区」id */
  workspaceValue: string;
  onToChange: (id: string) => void;
  onWorkspaceChange: (id: string) => void;
  /**
   * 初始文本：用于接收 pending-message（Dashboard 任务卡跳转 / ChatPage 续发）。
   * 仅在 Composer 首次挂载时生效一次；后续 prop 变化不会重置输入（用户编辑优先）。
   * 若需要重新填入，请通过 `key` 重挂载（ChatPage 当前用 sessionId 作 key）。
   */
  initialText?: string;
  /**
   * 突出模式：空白对话页时输入框更大、更有吸引力（Orkas .new-chat-input-area 风格）。
   * 默认 false。
   */
  prominent?: boolean;
}

export function Composer({
  onSend,
  onAbort,
  status,
  modelSelector,
  toOptions,
  workspaceOptions,
  toValue,
  workspaceValue,
  onToChange,
  onWorkspaceChange,
  initialText = '',
  prominent = false,
}: ComposerProps) {
  const { t } = useTranslation();
  const [text, setText] = useState(initialText);
  const [pendingTextApplied, setPendingTextApplied] = useState<string | null>(null);

  // pending-message → 外部传入 initialText → 写入 textarea（仅一次）
  // 仅当 initialText 是「之前没消费过的」时才覆盖用户编辑。
  useEffect(() => {
    if (
      typeof initialText === 'string' &&
      initialText.length > 0 &&
      initialText !== pendingTextApplied
    ) {
      setText(initialText);
      setPendingTextApplied(initialText);
    }
  }, [initialText, pendingTextApplied]);
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const sendingRef = useRef(false);
  const isStreaming = status === 'streaming' || status === 'submitting' || status === 'reconnecting';

  /**
   * 「+」按钮上传入口：
   *   1. 全部塞进 validateAttachments
   *   2. 失败 → 一次性 toast（多 failure 时合并文案）
   *   3. 通过 → 把 File 转 AttachmentDraft 数组加入 state
   */
  const handleAddFiles = (files: File[]) => {
    const failures = validateAttachments(files, attachments);
    if (failures.length > 0) {
      setErrorToast(mergeFailureMessages(failures));
      window.setTimeout(() => setErrorToast(null), 3500);
      return;
    }
    const drafts: AttachmentDraft[] = files.map((f) => ({
      id:
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `att-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file: f,
      mimeType: f.type,
      size: f.size,
      uploadStatus: 'pending',
    }));
    setAttachments((prev) => [...prev, ...drafts]);
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if ((!text.trim() && attachments.length === 0) || isStreaming || sendingRef.current) return;
    sendingRef.current = true;
    onSend(text.trim(), attachments);
    setText('');
    setAttachments([]);
    window.setTimeout(() => {
      sendingRef.current = false;
    }, 500);
  };

  /**
   * 键盘处理 —— 含 IME 组合态守卫。
   *
   * 参考 Orkas `conversation.js` L793 / L1958 / L2180 / L4339 / L9387：
   *   中文输入法按回车确认候选词时，keydown 事件的 `isComposing` 为 true，
   *   且 `keyCode` 为 229。如果不在 composition 期间过滤回车，会导致
   *   用户选择候选词时意外发送消息。
   *
   * 修复方案：composition 期间直接 return，Enter 只用于确认 IME 候选词。
   */
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // IME 组合态：回车仅用于确认候选词，不触发发送
    // React 合成事件不直接暴露 isComposing，需通过 nativeEvent 访问
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const canSend = (text.trim().length > 0 || attachments.length > 0) && !isStreaming;

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="composer-form"
      className="border-t border-border px-4 py-3 bg-surface shrink-0"
    >
      {/* Top row: model + thinking */}
      {modelSelector && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">{modelSelector}</div>
      )}

      {/* ── 输入卡片（Orkas .chat-input-area 风格）──
          max-w:80% 居中、14px 圆角、resting shadow、focus-within 边框高亮 + 上浮。
          prominent 模式：更大输入框、更强阴影（Orkas .new-chat-input-area）。 */}
      <div
        className={`
          mx-auto flex flex-col gap-1.5
          rounded-[14px] border bg-surface
          transition-all duration-200
          focus-within:border-primary
          focus-within:-translate-y-0.5
          ${prominent
            ? 'max-w-[720px] shadow-[0_4px_32px_rgba(28,45,89,0.06),0_1px_0_rgba(255,255,255,0.7)_inset] border-[var(--color-border)] focus-within:shadow-[0_4px_32px_rgba(108,92,231,0.12)]'
            : 'max-w-[80%] shadow-[0_4px_24px_rgba(15,18,24,0.04)] border-border focus-within:shadow-[0_4px_32px_rgba(108,92,231,0.12)]'
          }
        `}
      >
        {/* Error toast */}
        {errorToast && (
          <div
            role="alert"
            data-testid="composer-error-toast"
            className="mx-3 mt-2 flex items-start gap-2 px-3 py-2 rounded-md border border-danger/30 bg-danger-bg text-xs text-danger"
          >
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{errorToast}</span>
          </div>
        )}

        {/* Attachment chips */}
        <div className="px-3 pt-2">
          <AttachmentList attachments={attachments} onRemove={handleRemoveAttachment} />
        </div>

        {/* Textarea — Orkas 风格：无边框、透明背景、15px 字号。
            prominent 模式：更大 min-height（80px），作为空白页主 CTA。 */}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('chat.placeholder')}
          rows={prominent ? 3 : 2}
          data-testid="composer-textarea"
          className={`w-full border-none outline-none resize-none px-4 py-1 text-[15px] leading-relaxed bg-transparent text-text placeholder:text-text-muted/50 max-h-[260px] ${
            prominent ? 'min-h-[80px]' : 'min-h-[40px]'
          }`}
          disabled={isStreaming}
        />

        {/* ── 底部栏（Orkas .chat-bottom-bar 风格）──
            [+] | divider | To:xxx | Workspace:xxx | spacer | send/stop icon */}
        <div className="flex items-center gap-1.5 px-3 pb-2.5 pt-0.5">
          <ComposerAttachmentButton onFiles={handleAddFiles} disabled={isStreaming} />

          {/* 1px 竖分隔线（Orkas .chat-composer-divider） */}
          <div className="w-px h-[18px] bg-border shrink-0 mx-0.5" />

          <ContextDropdown
            variant="to"
            value={toValue}
            options={toOptions}
            onChange={onToChange}
            defaultLabel={t('composer.context.ai_default')}
            disabled={isStreaming}
          />
          <ContextDropdown
            variant="workspace"
            value={workspaceValue}
            options={workspaceOptions}
            onChange={onWorkspaceChange}
            defaultLabel={t('composer.context.workspace_default')}
            disabled={isStreaming}
          />

          {/* 弹簧：把发送按钮推到最右 */}
          <div className="flex-1" />

          {/* 发送 / 停止按钮 —— Orkas .chat-send-btn 风格：纯图标、32x32、圆角 8px */}
          {isStreaming ? (
            <button
              type="button"
              onClick={onAbort}
              data-testid="composer-stop-button"
              aria-label={t('chat.stop')}
              className="
                w-8 h-8 flex items-center justify-center shrink-0
                bg-danger text-white border-none rounded-lg
                cursor-pointer
                shadow-[0_1px_2px_rgba(229,72,77,0.25)]
                hover:bg-[#b91c1c] transition-colors
              "
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              data-testid="composer-send-button"
              aria-label={t('chat.send')}
              className="
                w-8 h-8 flex items-center justify-center shrink-0
                bg-primary text-white border-none rounded-lg
                cursor-pointer
                shadow-[0_1px_2px_rgba(108,92,231,0.25)]
                hover:opacity-90 transition-opacity
                disabled:bg-surface-hover disabled:text-text-muted
                disabled:shadow-none disabled:cursor-not-allowed
              "
            >
              <Send size={14} />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

/**
 * 把多条 ValidationFailure 合成一条 toast 文案（不重复同类）。
 */
function mergeFailureMessages(failures: ValidationFailure[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const f of failures) {
    if (seen.has(f.code)) continue;
    seen.add(f.code);
    lines.push(f.message);
  }
  return lines.join('；');
}
