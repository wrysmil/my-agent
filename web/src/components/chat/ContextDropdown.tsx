/**
 * Composer 「给：xxx / 工作区：xxx」上下文下拉。
 *
 * 来源：spec § 5.7 / 5.8 .ai-runtime-artifacts/specs/2026-08-09-chat-composer-redesign-spec.md
 * 落地：plan § Step 2.3
 *
 * 两组 dropdown：「给」(ai 目标) + 「工作区」(workspace)。
 * 本期选项列表写死：
 *   - 给：AI 默认 / 个人助理 / 调研员 / 写手 / 工程师
 *   - 工作区：默认 / 项目 A / 项目 B / 个人
 * 选项列表通过 props 注入，方便后续接 API。
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

export interface DropdownOption {
  id: string;
  label: string;
}

export interface ContextDropdownProps {
  /** 下拉唯一 key（'to' 或 'workspace'），用于 i18n */
  variant: 'to' | 'workspace';
  /** 当前选中 id */
  value: string;
  /** 选项列表 */
  options: readonly DropdownOption[];
  /** 选择回调 */
  onChange: (id: string) => void;
  /** 默认占位文案（当 value 为 default id 时显示） */
  defaultLabel: string;
  disabled?: boolean;
}

export function ContextDropdown({
  variant,
  value,
  options,
  onChange,
  defaultLabel,
  disabled = false,
}: ContextDropdownProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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

  const selected = options.find((o) => o.id === value);
  // 若未匹配到（value 是 default），用默认标签
  const isDefault = !selected || selected.id === '__default__';
  const displayLabel = isDefault ? defaultLabel : selected!.label;
  const prefixKey = variant === 'to' ? 'composer.context.to' : 'composer.context.workspace';
  const prefix = t(prefixKey, { value: displayLabel });

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        data-testid={`composer-context-${variant}-button`}
        className={`group flex items-center gap-1.5 h-7 px-2.5 rounded-full border bg-surface text-xs transition-all shadow-sm hover:shadow-md ${
          open
            ? 'border-primary ring-2 ring-primary/20'
            : 'border-border hover:border-primary/50'
        }`}
      >
        <span className="text-text-muted/80 truncate max-w-[140px]">{prefix}</span>
        <ChevronDown
          className={`w-3 h-3 text-text-muted/70 shrink-0 transition-transform ${
            open ? 'rotate-180 text-primary' : ''
          }`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          data-testid={`composer-context-${variant}-menu`}
          className="absolute bottom-full left-0 mb-2 z-50 min-w-[160px] rounded-xl border border-border bg-surface shadow-2xl py-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="border-b border-border/60" />
          {options.map((o) => {
            const isSelected = o.id === value;
            const showLabel = o.id === '__default__' ? defaultLabel : o.label;
            return (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                }}
                data-testid={`composer-context-${variant}-option-${o.id}`}
                className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-surface-hover transition-colors text-left ${
                  isSelected ? 'bg-primary/8' : ''
                }`}
              >
                <span
                  className={`block w-1.5 h-1.5 rounded-full shrink-0 ${
                    isSelected ? 'bg-primary' : 'bg-border'
                  }`}
                />
                <span
                  className={`truncate ${
                    isSelected ? 'text-primary font-semibold' : 'text-text font-medium'
                  }`}
                >
                  {showLabel}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}