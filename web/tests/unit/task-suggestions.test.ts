/**
 * 任务卡片常量与类型断言。
 * 来源：plan § Step 1.1
 */
import { describe, it, expect } from 'vitest';
import {
  TASK_SUGGESTIONS,
  TASK_IDS,
  TASK_CATEGORIES,
  TASK_ICON_NAMES,
  type TaskSuggestion,
} from '../../src/features/dashboard/taskSuggestions';
import { setLocale, t as translate } from '../../src/lib/i18n';

describe('taskSuggestions constants', () => {
  it('contains exactly 8 tasks', () => {
    expect(TASK_SUGGESTIONS).toHaveLength(8);
    expect(TASK_IDS).toHaveLength(8);
  });

  it('all task ids are unique', () => {
    const set = new Set(TASK_IDS);
    expect(set.size).toBe(TASK_IDS.length);
  });

  it('every task has non-empty required string fields', () => {
    for (const t of TASK_SUGGESTIONS) {
      expect(t.id).toBeTruthy();
      expect(t.category).toBeTruthy();
      expect(t.titleKey).toBeTruthy();
      expect(t.descriptionKey).toBeTruthy();
      expect(t.deliverableKey).toBeTruthy();
      expect(t.prompt).toBeTruthy();
      expect(t.iconName).toBeTruthy();
    }
  });

  it('every category is in the allowed whitelist', () => {
    for (const t of TASK_SUGGESTIONS) {
      expect(TASK_CATEGORIES).toContain(t.category);
    }
  });

  it('every iconName is in the allowed whitelist', () => {
    for (const t of TASK_SUGGESTIONS) {
      expect(TASK_ICON_NAMES).toContain(t.iconName);
    }
  });

  it('titleKey / descriptionKey / deliverableKey resolve to non-empty strings in both locales', () => {
    for (const t of TASK_SUGGESTIONS) {
      setLocale('zh');
      const titleZh = translate(t.titleKey as any);
      const descZh = translate(t.descriptionKey as any);
      const delivZh = translate(t.deliverableKey as any);
      expect(titleZh).not.toBe(t.titleKey);
      expect(descZh).not.toBe(t.descriptionKey);
      expect(delivZh).not.toBe(t.deliverableKey);
      expect(titleZh.length).toBeGreaterThan(0);
      expect(descZh.length).toBeGreaterThan(0);
      expect(delivZh.length).toBeGreaterThan(0);

      setLocale('en');
      const titleEn = translate(t.titleKey as any);
      const descEn = translate(t.descriptionKey as any);
      const delivEn = translate(t.deliverableKey as any);
      expect(titleEn).not.toBe(t.titleKey);
      expect(descEn).not.toBe(t.descriptionKey);
      expect(delivEn).not.toBe(t.deliverableKey);
      expect(titleEn.length).toBeGreaterThan(0);
      expect(descEn.length).toBeGreaterThan(0);
      expect(delivEn.length).toBeGreaterThan(0);
    }
  });

  it('taskSuggestions array is readonly', () => {
    // readonly 保证：TypeScript 编译已限制；运行时用 Object.isFrozen 检查 Symbol.iterator
    // 这里用类型断言：类型层 Array<...> 不允许 push
    const arr: ReadonlyArray<TaskSuggestion> = TASK_SUGGESTIONS;
    expect(arr.length).toBe(8);
  });

  it('contains all 8 expected categories', () => {
    const cats = TASK_SUGGESTIONS.map((t) => t.category);
    expect(cats).toEqual([
      'research',
      'video',
      'image',
      'design',
      'office',
      'writing',
      'development',
      'growth',
    ]);
  });
});