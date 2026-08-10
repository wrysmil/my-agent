/**
 * Composer 「+」按钮：弹出菜单，上传 / 剪贴板 / 远程 URL 三入口。
 *
 * 来源：spec § 5.3 .ai-runtime-artifacts/specs/2026-08-09-chat-composer-redesign-spec.md
 * 落地：plan § Step 2.2
 *
 * 行为：
 *   - 点「+」→ 弹出 popover，菜单三项
 *   - 点「上传」→ 触发 hidden <input type="file" multiple> 的 click
 *   - 点「剪贴板」→ 调 navigator.clipboard.read()（本期 try/catch；fallback toast）
 *   - 点「远程 URL」→ prompt 输入框（本期 toast「本期未实装」）
 *
 * 所有三种入口都回调到 onFiles（File 列表）。校验在 Composer 层用 validateAttachments 统一做。
 */

import { useEffect, useRef, useState } from 'react';
import { Plus, Upload, ClipboardPaste, Link2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

export interface ComposerAttachmentButtonProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}

export function ComposerAttachmentButton({
  onFiles,
  disabled = false,
}: ComposerAttachmentButtonProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // outside click 关 popover
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    onFiles(Array.from(fileList));
    setOpen(false);
  };

  const onUploadClick = () => {
    fileInputRef.current?.click();
  };

  const onClipboardClick = async () => {
    setOpen(false);
    try {
      if (!navigator.clipboard || !('read' in navigator.clipboard)) {
        throw new Error('Clipboard API not available');
      }
      const items = await (navigator.clipboard as any).read();
      const files: File[] = [];
      for (const item of items as Array<{ types: string[]; getType: (t: string) => Promise<Blob> }>) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type);
            files.push(new File([blob], `clipboard-${Date.now()}.${type.split('/')[1]}`, { type }));
          }
        }
      }
      if (files.length === 0) {
        console.warn(t('composer.attachment.toast_stub'));
      } else {
        onFiles(files);
      }
    } catch {
      console.warn(t('composer.attachment.toast_stub'));
    }
  };

  const onUrlClick = () => {
    setOpen(false);
    console.warn(t('composer.attachment.toast_stub'));
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-label={t('composer.attachment.add')}
        aria-expanded={open}
        aria-haspopup="menu"
        data-testid="composer-attachment-button"
        className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-border bg-surface text-text-muted hover:text-text hover:border-primary/50 hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Plus className="w-4 h-4" />
      </button>

      {open && (
        <div
          role="menu"
          data-testid="composer-attachment-menu"
          className="absolute bottom-full left-0 mb-2 z-50 min-w-[180px] rounded-xl border border-border bg-surface shadow-2xl py-1.5"
        >
          <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-text-muted/70">
            {t('composer.attachment.popover_title')}
          </div>
          <div className="border-t border-border/60" />
          <MenuItem
            icon={<Upload className="w-3.5 h-3.5" />}
            label={t('composer.attachment.menu_upload')}
            onClick={onUploadClick}
            testid="composer-attachment-menu-upload"
          />
          <MenuItem
            icon={<ClipboardPaste className="w-3.5 h-3.5" />}
            label={t('composer.attachment.menu_clipboard')}
            onClick={onClipboardClick}
            testid="composer-attachment-menu-clipboard"
          />
          <MenuItem
            icon={<Link2 className="w-3.5 h-3.5" />}
            label={t('composer.attachment.menu_url')}
            onClick={onUrlClick}
            testid="composer-attachment-menu-url"
          />
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        data-testid="composer-attachment-file-input"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  testid,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  testid: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      data-testid={testid}
      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-surface-hover transition-colors text-left"
    >
      <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-surface-hover text-text-muted shrink-0">
        {icon}
      </span>
      <span className="text-text font-medium">{label}</span>
    </button>
  );
}