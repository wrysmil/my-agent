/**
 * TraceBubble 组件测试（v4 双布局重构）
 *
 * 设计动机：见 spec `.ai-runtime-artifacts/specs/2026-08-11-run-trace-dual-layout-spec.md` § 4.2。
 * v4 CycleCard → TraceBubble：trace 独立灰色气泡，final 已是独立 DOM 节点（不进 bubble）。
 * 覆盖：children 渲染、灰色背景 `bg-[#f1f2f4]`、max-width 660px、self-start 左对齐、
 *      p-0（内部 RunTracePanel 自带 padding）、不含 final markdown、不在 tab 流。
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TraceBubble } from '@/components/chat/TraceBubble';

describe('TraceBubble', () => {
  it('渲染 children', () => {
    // Arrange
    render(
      <TraceBubble>
        <span>hello trace</span>
      </TraceBubble>,
    );

    // Assert
    expect(screen.getByText('hello trace')).toBeTruthy();
  });

  it('v4 容器背景为灰色（bg-[#f1f2f4]）', () => {
    // Arrange
    const { container } = render(
      <TraceBubble>
        <span>x</span>
      </TraceBubble>,
    );

    // Assert
    const root = container.firstElementChild;
    expect(root?.className ?? '').toContain('bg-[#f1f2f4]');
  });

  it('v4 容器宽度 max-w-[660px] + w-full（相邻卡片对齐）', () => {
    // Arrange
    const { container } = render(
      <TraceBubble>
        <span>x</span>
      </TraceBubble>,
    );

    // Assert
    const root = container.firstElementChild;
    expect(root?.className ?? '').toContain('max-w-[660px]');
    expect(root?.className ?? '').toContain('w-full');
  });

  it('v4 容器自左对齐（self-start）', () => {
    // Arrange
    const { container } = render(
      <TraceBubble>
        <span>x</span>
      </TraceBubble>,
    );

    // Assert
    const root = container.firstElementChild;
    expect(root?.className ?? '').toContain('self-start');
  });

  it('v4 容器为 p-0（内部 RunTracePanel 自带 padding）', () => {
    // Arrange
    const { container } = render(
      <TraceBubble>
        <span>x</span>
      </TraceBubble>,
    );

    // Assert — 容器本身无 px-4 / py-3.5
    const root = container.firstElementChild;
    expect(root?.className ?? '').not.toContain('px-4');
    expect(root?.className ?? '').not.toContain('py-3.5');
  });

  it('v4 容器带 data-testid="trace-bubble"（便于 MessageBubble 测试断言）', () => {
    // Arrange
    const { container } = render(
      <TraceBubble>
        <span>x</span>
      </TraceBubble>,
    );

    // Assert
    const root = container.firstElementChild;
    expect(root?.getAttribute('data-testid')).toBe('trace-bubble');
  });

  it('v4 容器不在 tab 流（无 tabindex / 无按钮）', () => {
    // Arrange
    const { container } = render(
      <TraceBubble>
        <span>x</span>
      </TraceBubble>,
    );

    // Assert
    const root = container.firstElementChild;
    expect(root?.tagName).toBe('DIV');
    expect(root?.getAttribute('tabindex')).toBeNull();
    expect(root?.querySelector('button')).toBeNull();
  });

  it('v4 容器本身不含 final markdown 文本（仅 trace 步骤）', () => {
    // Arrange
    const { container } = render(
      <TraceBubble>
        <span>trace step</span>
      </TraceBubble>,
    );

    // Assert — 容器内不应含 prose / Markdown 节点
    expect(container.querySelector('.prose')).toBeNull();
  });
});
