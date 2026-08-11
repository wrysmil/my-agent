/**
 * GeneratingIndicator 组件测试（v3.1 简化版）
 *
 * 覆盖：role/aria-live、Loader2 图标存在、与 final 之间分隔线、不含"AI 仍在生成中"文字。
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GeneratingIndicator } from '@/components/chat/GeneratingIndicator';

describe('GeneratingIndicator', () => {
  it('role=status + aria-live=polite', () => {
    // Arrange / Act
    render(<GeneratingIndicator />);

    // Assert
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
  });

  it('v3.1：不含「AI 仍在生成中」文字（仅保留转圈）', () => {
    // Arrange / Act
    render(<GeneratingIndicator />);

    // Assert
    expect(screen.queryByText('AI 仍在生成中…')).toBeNull();
    expect(screen.queryByText(/AI/)).toBeNull();
  });

  it('含 Loader2 svg 图标（animate-spin）', () => {
    // Arrange
    const { container } = render(<GeneratingIndicator />);

    // Assert
    const svg = container.querySelector('svg.animate-spin');
    expect(svg).toBeTruthy();
  });

  it('与 final 之间存在分隔线（border-dashed）', () => {
    // Arrange
    const { container } = render(<GeneratingIndicator />);

    // Assert
    const root = container.firstElementChild;
    expect(root?.className ?? '').toContain('border-dashed');
  });
});