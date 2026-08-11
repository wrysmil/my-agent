/**
 * CycleCard 组件测试
 *
 * 覆盖：children 渲染、左侧竖条 aria-hidden、不在 tab 流。
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CycleCard } from '@/components/chat/CycleCard';

describe('CycleCard', () => {
  it('渲染 children', () => {
    // Arrange
    render(
      <CycleCard>
        <span>hello cycle</span>
      </CycleCard>,
    );

    // Assert
    expect(screen.getByText('hello cycle')).toBeTruthy();
  });

  it('左侧竖条存在且 aria-hidden', () => {
    // Arrange
    const { container } = render(
      <CycleCard>
        <span>x</span>
      </CycleCard>,
    );

    // Assert
    const bar = container.querySelector('span[aria-hidden="true"]');
    expect(bar).toBeTruthy();
    expect(bar?.className ?? '').toContain('bg-gradient-to-b');
  });

  it('容器本身不在 tab 流（无 tabindex / 无按钮）', () => {
    // Arrange
    const { container } = render(
      <CycleCard>
        <span>x</span>
      </CycleCard>,
    );

    // Assert
    const root = container.firstElementChild;
    expect(root?.tagName).toBe('DIV');
    expect(root?.getAttribute('tabindex')).toBeNull();
    expect(root?.querySelector('button')).toBeNull();
  });
});