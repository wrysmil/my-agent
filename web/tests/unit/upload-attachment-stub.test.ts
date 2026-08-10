/**
 * uploadAttachment stub 行为契约。
 * 来源：plan § Step 1.3
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { uploadAttachment } from '../../src/features/attachments/uploadAttachment';

function makeFile(name: string, sizeBytes: number, type = 'image/png'): File {
  const blob = new Blob([new Uint8Array(sizeBytes)], { type });
  return new File([blob], name, { type });
}

describe('uploadAttachment stub', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('console.warn 命中关键字「stub：本期未实装真实上传」', async () => {
    const file = makeFile('a.png', 1024);
    const ac = new AbortController();
    const promise = uploadAttachment(file, ac.signal);
    await vi.advanceTimersByTimeAsync(1500);
    await promise;
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('stub：本期未实装真实上传'),
      expect.stringContaining('a.png'),
      expect.any(String),
    );
  });

  it('返回 { url } 且 url 为 blob: 协议', async () => {
    const file = makeFile('b.png', 2048);
    const ac = new AbortController();
    const promise = uploadAttachment(file, ac.signal);
    await vi.advanceTimersByTimeAsync(1500);
    const result = await promise;
    expect(result.remoteId).toBeUndefined();
    expect(typeof result.url).toBe('string');
    expect(result.url.length).toBeGreaterThan(0);
  });

  it('调用前先 abort → 立刻抛 AbortError', async () => {
    const file = makeFile('c.png', 1024);
    const ac = new AbortController();
    ac.abort();
    await expect(uploadAttachment(file, ac.signal)).rejects.toThrow(/Aborted/);
  });

  it('调用期间 abort → 抛 AbortError', async () => {
    const file = makeFile('d.png', 1024);
    const ac = new AbortController();
    // 500ms 后 abort（在 1500ms 延迟内）
    vi.advanceTimersByTime(500);
    ac.abort();
    const promise = uploadAttachment(file, ac.signal);
    // 提前 attach catch 防止 Node 报 UnhandledRejection
    const assertion = expect(promise).rejects.toThrow(/Aborted/);
    await assertion;
  });

  it('正常完成耗时约 1500ms', async () => {
    const file = makeFile('e.png', 1024);
    const ac = new AbortController();
    const promise = uploadAttachment(file, ac.signal);
    await vi.advanceTimersByTimeAsync(1500);
    await promise;
    expect(console.warn).toHaveBeenCalled();
  });
});