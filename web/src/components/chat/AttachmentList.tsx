/**
 * Composer 附件 chip 列表。
 *
 * 来源：spec § 5.5 / 5.6 .ai-runtime-artifacts/specs/2026-08-09-chat-composer-redesign-spec.md
 * 落地：plan § Step 2.1
 *
 * 渲染一排带「文件图标 + 文件名 + 大小 + ✕ 移除按钮」的 chip。
 * 单文件最大 10MB，超过即显示 ⚠️ 标记（仅视觉提示；validateAttachments 已在入口拦截）。
 *
 * 设计要点：
 *   - chip 用 pill 样式（rounded-full + 浅背景）
 *   - 文件名超长截断（max-w）
 *   - 大小显示 KB / MB 自动切换
 *   - ✕ 按钮独立可点；hover 整 chip 高亮
 */

import { FileText, Image as ImageIcon, AlertCircle, X } from 'lucide-react';
import type { AttachmentDraft } from '@/features/attachments/validateAttachment';

export function AttachmentList({
  attachments,
  onRemove,
}: {
  attachments: readonly AttachmentDraft[];
  onRemove: (id: string) => void;
}) {
  if (attachments.length === 0) return null;

  return (
    <div
      className="flex flex-wrap gap-1.5 mb-2"
      data-testid="composer-attachment-list"
      role="list"
      aria-label="附件"
    >
      {attachments.map((a) => (
        <AttachmentChip key={a.id} attachment={a} onRemove={onRemove} />
      ))}
    </div>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: AttachmentDraft;
  onRemove: (id: string) => void;
}) {
  const oversized = attachment.size > 10 * 1024 * 1024;
  const isImage = attachment.mimeType.startsWith('image/');
  const sizeLabel = formatSize(attachment.size);

  return (
    <span
      role="listitem"
      data-testid="composer-attachment-chip"
      className="group inline-flex items-center gap-1.5 h-7 pl-2 pr-1 rounded-full bg-surface-hover border border-border text-xs hover:border-primary/40 transition-colors"
    >
      {isImage ? (
        <ImageIcon className="w-3 h-3 text-text-muted shrink-0" />
      ) : (
        <FileText className="w-3 h-3 text-text-muted shrink-0" />
      )}
      <span className="max-w-[120px] truncate text-text">{attachment.file.name}</span>
      <span className="text-text-muted/70 tabular-nums">{sizeLabel}</span>
      {oversized && (
        <AlertCircle
          className="w-3 h-3 text-danger shrink-0"
          aria-label="文件过大"
          data-testid="composer-attachment-oversize"
        />
      )}
      <button
        type="button"
        onClick={() => onRemove(attachment.id)}
        aria-label="移除附件"
        data-testid="composer-attachment-remove"
        className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-text-muted hover:text-text hover:bg-bg/80 transition-colors"
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}