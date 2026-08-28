/**
 * QuestionComposer — 提问响应组件。
 *
 * 用途：Agent 向用户提问时，显示交互式响应选项。
 *
 * 支持的问题类型：
 * - radio: 单选
 * - checkbox: 多选
 * - text: 自由输入
 * - plan-review: 决策卡
 */

import { useState } from 'react';
import { Check, CircleDot, Square, Type } from 'lucide-react';

export interface QuestionOption {
  id: string;
  label: string;
  description?: string;
}

export interface QuestionComposerProps {
  /** 问题标题 */
  title: string;
  /** 问题类型 */
  type: 'radio' | 'checkbox' | 'text' | 'plan-review';
  /** 选项（radio/checkbox 时） */
  options?: QuestionOption[];
  /** 占位符（text 时） */
  placeholder?: string;
  /** 提交回调 */
  onSubmit: (value: string | string[]) => void;
  /** 取消回调 */
  onCancel?: () => void;
  /** 是否禁用 */
  disabled?: boolean;
}

export function QuestionComposer({
  title,
  type,
  options = [],
  placeholder = '请输入...',
  onSubmit,
  onCancel,
  disabled = false,
}: QuestionComposerProps) {
  const [selected, setSelected] = useState<string | string[]>(
    type === 'checkbox' ? [] : '',
  );
  const [textValue, setTextValue] = useState('');

  const handleSubmit = () => {
    if (disabled) return;

    if (type === 'text') {
      if (textValue.trim()) {
        onSubmit(textValue.trim());
      }
    } else if (type === 'checkbox') {
      const selectedArray = selected as string[];
      if (selectedArray.length > 0) {
        onSubmit(selectedArray);
      }
    } else {
      if (selected) {
        onSubmit(selected as string);
      }
    }
  };

  const toggleOption = (optionId: string) => {
    if (type === 'radio') {
      setSelected(optionId);
    } else if (type === 'checkbox') {
      const current = selected as string[];
      if (current.includes(optionId)) {
        setSelected(current.filter((id) => id !== optionId));
      } else {
        setSelected([...current, optionId]);
      }
    }
  };

  const canSubmit = () => {
    if (disabled) return false;
    if (type === 'text') return textValue.trim().length > 0;
    if (type === 'checkbox') return (selected as string[]).length > 0;
    return Boolean(selected);
  };

  return (
    <div className="w-full max-w-md mx-auto p-4 rounded-xl border border-border bg-white dark:bg-gray-800 shadow-lg">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
          <Type size={16} className="text-primary" />
        </div>
        <h3 className="text-sm font-semibold text-text">{title}</h3>
      </div>

      {/* Options / Input */}
      <div className="space-y-2 mb-4">
        {type === 'text' ? (
          <textarea
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            rows={3}
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface-hover/50 text-sm text-text placeholder:text-text-muted resize-none focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
          />
        ) : type === 'plan-review' ? (
          <PlanReviewOptions onSelect={setSelected} selected={selected as string} />
        ) : (
          options.map((option) => (
            <button
              key={option.id}
              onClick={() => toggleOption(option.id)}
              disabled={disabled}
              className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-colors disabled:opacity-50 ${
                (type === 'radio' && selected === option.id) ||
                (type === 'checkbox' && (selected as string[]).includes(option.id))
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50 hover:bg-surface-hover/50'
              }`}
            >
              <span className="mt-0.5 shrink-0">
                {type === 'radio' ? (
                  <CircleDot
                    size={18}
                    className={
                      selected === option.id
                        ? 'text-primary'
                        : 'text-text-muted'
                    }
                  />
                ) : (
                  <Square
                    size={18}
                    className={
                      (selected as string[]).includes(option.id)
                        ? 'text-primary'
                        : 'text-text-muted'
                    }
                  />
                )}
              </span>
              <span className="flex-1 min-w-0">
                <span className="text-sm font-medium text-text block">
                  {option.label}
                </span>
                {option.description && (
                  <span className="text-xs text-text-muted mt-0.5 block">
                    {option.description}
                  </span>
                )}
              </span>
              {(type === 'radio' && selected === option.id) ||
              (type === 'checkbox' &&
                (selected as string[]).includes(option.id)) ? (
                <Check size={16} className="shrink-0 text-primary mt-0.5" />
              ) : null}
            </button>
          ))
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <button
            onClick={onCancel}
            disabled={disabled}
            className="px-3 py-1.5 rounded-lg text-sm text-text-muted hover:bg-surface-hover transition-colors disabled:opacity-50"
          >
            取消
          </button>
        )}
        <button
          onClick={handleSubmit}
          disabled={!canSubmit()}
          className="px-4 py-1.5 rounded-lg text-sm bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          提交
        </button>
      </div>
    </div>
  );
}

// ─── Plan Review Options ───────────────────────────────────────────────────────

function PlanReviewOptions({
  onSelect,
  selected,
}: {
  onSelect: (id: string) => void;
  selected: string;
}) {
  const planOptions: QuestionOption[] = [
    { id: 'approve', label: '✓ 同意', description: '批准执行当前计划' },
    { id: 'revise', label: '✏ 修改', description: '对计划提出修改意见' },
    { id: 'reject', label: '✗ 拒绝', description: '终止当前任务' },
  ];

  return (
    <div className="space-y-2">
      <p className="text-xs text-text-muted mb-2">请选择操作：</p>
      {planOptions.map((option) => (
        <button
          key={option.id}
          onClick={() => onSelect(option.id)}
          className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-colors ${
            selected === option.id
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-primary/50 hover:bg-surface-hover/50'
          }`}
        >
          <span className="mt-0.5 shrink-0">
            <CircleDot
              size={18}
              className={selected === option.id ? 'text-primary' : 'text-text-muted'}
            />
          </span>
          <span className="flex-1 min-w-0">
            <span className="text-sm font-medium text-text block">
              {option.label}
            </span>
            {option.description && (
              <span className="text-xs text-text-muted mt-0.5 block">
                {option.description}
              </span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}
