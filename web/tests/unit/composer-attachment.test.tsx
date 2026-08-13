/**
 * Composer 附件流整合单测。
 *
 * 来源：plan § Step 2.4
 *
 * 覆盖：
 *   - 点「+」→ 弹出 popover，再点 item → 触发 onFiles
 *   - 选白名单文件 → chip 出现
 *   - 选非白名单 → toast 出现，chip 不出现
 *   - 选超大文件 → toast 出现，chip 不出现
 *   - 移除 chip → chip 消失
 *   - 「+」popover outside click 关闭
 *   - 发送：文本 + 附件都存在 → onSend(text, attachments) 触发，state 重置
 *   - 流式状态：textarea disabled、stop 按钮出现
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { Composer } from '../../src/components/chat/Composer';
import type { AttachmentDraft } from '../../src/features/attachments/validateAttachment';
import type { ChatStatus } from '../../src/features/chat/types';

function makeFile(name: string, type: string, sizeBytes: number): File {
  const blob = new Blob([new Uint8Array(sizeBytes)], { type });
  return new File([blob], name, { type });
}

interface RenderArgs {
  onSend?: ReturnType<typeof vi.fn>;
  onAbort?: ReturnType<typeof vi.fn>;
  status?: ChatStatus;
}

function renderComposer({
  onSend = vi.fn(),
  onAbort = vi.fn(),
  status = 'idle',
}: RenderArgs = {}) {
  const utils = render(
    <Composer
      onSend={onSend}
      onAbort={onAbort}
      status={status}
    />,
  );
  return { ...utils, onSend, onAbort };
}

describe('Composer attachment flow', () => {
  it('渲染默认态：textarea + + 按钮', () => {
    renderComposer();
    expect(screen.getByTestId('composer-textarea')).toBeInTheDocument();
    expect(screen.getByTestId('composer-attachment-button')).toBeInTheDocument();
    // 默认无附件
    expect(screen.queryByTestId('composer-attachment-list')).not.toBeInTheDocument();
  });

  it('点 + → popover 出现，再点 outside 关闭', async () => {
    renderComposer();
    const btn = screen.getByTestId('composer-attachment-button');
    fireEvent.click(btn);
    expect(screen.getByTestId('composer-attachment-menu')).toBeInTheDocument();
    // 点 outside
    fireEvent.mouseDown(document.body);
    await waitFor(() => {
      expect(screen.queryByTestId('composer-attachment-menu')).not.toBeInTheDocument();
    });
  });

  it('通过「上传」入口选白名单文件 → chip 出现', async () => {
    const { container } = renderComposer();
    const btn = screen.getByTestId('composer-attachment-button');
    fireEvent.click(btn);
    const file = makeFile('ok.png', 'image/png', 1024);
    const input = container.querySelector(
      '[data-testid="composer-attachment-file-input"]',
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
    // jsdom 不真正分配 file 列表，用 Object.defineProperty 直接设置
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    await waitFor(() => {
      expect(screen.getByTestId('composer-attachment-list')).toBeInTheDocument();
    });
    const chips = screen.getAllByTestId('composer-attachment-chip');
    expect(chips).toHaveLength(1);
  });

  it('选 .exe（白名单外） → toast 出现，chip 不出现', async () => {
    const { container } = renderComposer();
    const btn = screen.getByTestId('composer-attachment-button');
    fireEvent.click(btn);
    const bad = makeFile('hack.exe', 'application/x-msdownload', 1024);
    const input = container.querySelector(
      '[data-testid="composer-attachment-file-input"]',
    ) as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [bad], configurable: true });
    fireEvent.change(input);
    await waitFor(() => {
      expect(screen.getByTestId('composer-error-toast')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('composer-attachment-chip')).not.toBeInTheDocument();
  });

  it('选超大文件 → toast 出现', async () => {
    const { container } = renderComposer();
    fireEvent.click(screen.getByTestId('composer-attachment-button'));
    const big = makeFile('huge.png', 'image/png', 11 * 1024 * 1024);
    const input = container.querySelector(
      '[data-testid="composer-attachment-file-input"]',
    ) as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [big], configurable: true });
    fireEvent.change(input);
    await waitFor(() => {
      expect(screen.getByTestId('composer-error-toast')).toBeInTheDocument();
    });
  });

  it('点 chip 的移除按钮 → chip 消失', async () => {
    const { container } = renderComposer();
    fireEvent.click(screen.getByTestId('composer-attachment-button'));
    const ok = makeFile('a.png', 'image/png', 100);
    const input = container.querySelector(
      '[data-testid="composer-attachment-file-input"]',
    ) as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [ok], configurable: true });
    fireEvent.change(input);
    await waitFor(() => {
      expect(screen.getByTestId('composer-attachment-chip')).toBeInTheDocument();
    });
    const removeBtn = screen.getByTestId('composer-attachment-remove');
    fireEvent.click(removeBtn);
    await waitFor(() => {
      expect(screen.queryByTestId('composer-attachment-chip')).not.toBeInTheDocument();
    });
  });

  it('发送：文本 + 附件 → onSend(text, [attachments]) 触发，state 重置', async () => {
    const { onSend, container } = renderComposer();
    // 加一个附件
    fireEvent.click(screen.getByTestId('composer-attachment-button'));
    const f = makeFile('a.png', 'image/png', 100);
    const input = container.querySelector(
      '[data-testid="composer-attachment-file-input"]',
    ) as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [f], configurable: true });
    fireEvent.change(input);
    await waitFor(() => {
      expect(screen.getByTestId('composer-attachment-chip')).toBeInTheDocument();
    });
    // 输入文本
    const textarea = screen.getByTestId('composer-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '帮我看看' } });
    // 点发送
    fireEvent.click(screen.getByTestId('composer-send-button'));
    expect(onSend).toHaveBeenCalledTimes(1);
    const [text, attachments] = onSend.mock.calls[0];
    expect(text).toBe('帮我看看');
    expect(Array.isArray(attachments)).toBe(true);
    expect((attachments as AttachmentDraft[]).length).toBe(1);
    expect((attachments as AttachmentDraft[])[0].file.name).toBe('a.png');
    // state 已重置
    await waitFor(() => {
      expect(screen.queryByTestId('composer-attachment-chip')).not.toBeInTheDocument();
    });
    expect((textarea as HTMLTextAreaElement).value).toBe('');
  });

  it('流式状态：textarea disabled + 显示停止按钮', () => {
    renderComposer({ status: 'streaming' });
    expect((screen.getByTestId('composer-textarea') as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.getByTestId('composer-stop-button')).toBeInTheDocument();
    expect(screen.queryByTestId('composer-send-button')).not.toBeInTheDocument();
  });

  it('点 stop 按钮 → 触发 onAbort', () => {
    const { onAbort } = renderComposer({ status: 'streaming' });
    fireEvent.click(screen.getByTestId('composer-stop-button'));
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  it('空文本 + 空附件 → 发送按钮 disabled', () => {
    renderComposer();
    const sendBtn = screen.getByTestId('composer-send-button') as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
  });

  it('发送按钮状态切换：空 → 输入启用 → 清空恢复禁用（含纯空格守卫）', () => {
    renderComposer();
    const textarea = screen.getByTestId('composer-textarea') as HTMLTextAreaElement;
    const sendBtn = () => screen.getByTestId('composer-send-button') as HTMLButtonElement;

    // 初始：空输入 → 禁用
    expect(sendBtn().disabled).toBe(true);

    // 输入文本 → 启用（状态切换 1）
    fireEvent.change(textarea, { target: { value: '你好' } });
    expect(sendBtn().disabled).toBe(false);

    // 纯空格 → 仍禁用（trim 守卫，不发空白消息）
    fireEvent.change(textarea, { target: { value: '   ' } });
    expect(sendBtn().disabled).toBe(true);

    // 再次输入 → 再启用（状态切换 2）
    fireEvent.change(textarea, { target: { value: '你好世界' } });
    expect(sendBtn().disabled).toBe(false);

    // 清空 → 恢复禁用（状态切换 3）
    fireEvent.change(textarea, { target: { value: '' } });
    expect(sendBtn().disabled).toBe(true);
  });
});