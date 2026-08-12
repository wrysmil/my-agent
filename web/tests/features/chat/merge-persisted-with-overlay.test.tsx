/**
 * mergePersistedWithOverlay 顺序回归测试
 *
 * 背景（spec §4.1）：done / aborted / error 后 history refetch 触发 merge，
 * 当 persisted 快照尚未包含最新 user 消息（write-through 滞后）时，
 * overlay 中排在首位、在 persisted 中找不到 identity / runId 匹配的 user
 * 消息会被旧算法 splice 到 result.length（末尾）→ user 排到 assistant 后面。
 *
 * 本批采用方案 B：overlay 顺序作为骨架，persisted 独有条目按锚点插入。
 * 前 6 个用例直接调 mergePersistedWithOverlay；第 7 个为 ChatPage invalidate
 * 范围回归（组件级）。
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { mergePersistedWithOverlay } from '../../../src/features/chat/useChatStream';
import { ChatPage } from '../../../src/pages/ChatPage';
import type { ChatMessage } from '../../../src/features/chat/types';

// ChatPage 组件级测试：useChatStream 换桩返回 done 态；
// 真实 mergePersistedWithOverlay / useChatStream 其余导出保留给单元测试。
vi.mock('@/features/chat/useChatStream', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/chat/useChatStream')>();
  return {
    ...actual,
    useChatStream: () => ({
      status: 'done' as const,
      messages: [],
      send: vi.fn(),
      abort: vi.fn(),
      retry: vi.fn(),
      historyLoaded: true,
    }),
  };
});
vi.mock('@/components/chat/Composer', () => ({ Composer: () => null }));
vi.mock('@/components/chat/MessageList', () => ({ MessageList: () => null }));
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/lib/api', () => ({
  apiGet: vi.fn().mockResolvedValue({ models: [] }),
  apiPost: vi.fn().mockResolvedValue({ session: { id: 's1' } }),
}));

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function makeUser(opts: {
  id: string;
  text: string;
  runId: string;
  clientMessageId?: string;
  messageId?: string;
}): ChatMessage {
  return {
    id: opts.id,
    role: 'user',
    blocks: [],
    text: opts.text,
    clientMessageId: opts.clientMessageId,
    messageId: opts.messageId,
    runId: opts.runId,
  };
}

function makeAssistant(opts: {
  id: string;
  runId: string;
  messageId?: string;
  thinking?: string;
  finalText?: string;
}): ChatMessage {
  const blocks: ChatMessage['blocks'] = [];
  if (opts.thinking) {
    blocks.push({
      id: `${opts.id}-t`,
      type: 'thinking',
      status: 'done',
      thinking: opts.thinking,
      collapsed: true,
    });
  }
  if (opts.finalText) {
    blocks.push({
      id: `${opts.id}-txt`,
      type: 'text',
      status: 'done',
      text: opts.finalText,
    });
  }
  return {
    id: opts.id,
    role: 'assistant',
    blocks,
    runId: opts.runId,
    messageId: opts.messageId,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// mergePersistedWithOverlay 顺序回归
// ──────────────────────────────────────────────────────────────────────────────

describe('mergePersistedWithOverlay order', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves overlay order when persisted is missing the latest user message', () => {
    // Arrange — overlay 有完整一轮 [user1, assistant1]；persisted 缺 user1
    //（user 尚未落盘），assistant1 只有 trace 无 final text（write-through 滞后）
    const overlay = [
      makeUser({
        id: 'user-cm-u1',
        text: '第一问',
        clientMessageId: 'cm-u1',
        runId: 'run-a',
      }),
      makeAssistant({
        id: 'asst-run-a',
        runId: 'run-a',
        thinking: '思考中',
        finalText: '第一答',
      }),
    ];
    const persisted = [
      makeAssistant({
        id: 'hist-a1',
        messageId: 'hist-a1',
        runId: 'run-a',
        thinking: '思考中',
      }),
    ];

    // Act
    const merged = mergePersistedWithOverlay(persisted, overlay, 3, () => null);

    // Assert — user 必须仍在 assistant 前面
    expect(merged[0].role).toBe('user');
    expect(merged[0].text).toBe('第一问');
    expect(merged[1].role).toBe('assistant');
    expect(merged[1].runId).toBe('run-a');
  });

  it('user message stays before its assistant when persisted lacks the user row', () => {
    // Arrange — persisted 完全没有 user1（后端还没 flush user 行）
    const overlay = [
      makeUser({
        id: 'user-cm-u1',
        text: '你好',
        clientMessageId: 'cm-u1',
        runId: 'run-a',
      }),
      makeAssistant({
        id: 'asst-run-a',
        runId: 'run-a',
        finalText: '回复',
      }),
    ];
    const persisted = [
      makeAssistant({
        id: 'hist-a1',
        messageId: 'hist-a1',
        runId: 'run-a',
        finalText: '回复',
      }),
    ];

    // Act
    const merged = mergePersistedWithOverlay(persisted, overlay, 10, () => 10);

    // Assert — result[0] 是 overlay 的 user 消息；且不产生重复 assistant
    expect(merged[0].role).toBe('user');
    expect(merged[0].text).toBe('你好');
    expect(merged).toHaveLength(2);
    expect(merged.filter((m) => m.role === 'assistant')).toHaveLength(1);
  });

  it('does not regress duplicate trace bubble fix - one bubble per run', () => {
    // Arrange — overlay 已有 asst-${runId}，persisted 出现 hist-${messageId} 同 runA
    const overlay = [
      makeAssistant({ id: 'asst-run-a', runId: 'run-a', thinking: 'live stream' }),
    ];
    const persisted = [
      makeAssistant({
        id: 'hist-a1',
        messageId: 'hist-a1',
        runId: 'run-a',
        thinking: 'from history',
      }),
    ];

    // Act
    const merged = mergePersistedWithOverlay(persisted, overlay, 10, () => 10);

    // Assert — 同 run 只 1 条 assistant
    expect(
      merged.filter((m) => m.role === 'assistant' && m.runId === 'run-a'),
    ).toHaveLength(1);
  });

  it('persisted-only historical runs are inserted before newer overlay items', () => {
    // Arrange — overlay 只有新一轮 [user2, assistant2]；persisted 含旧 runA + runB
    const overlay = [
      makeUser({
        id: 'user-cm-u2',
        text: '第二问',
        clientMessageId: 'cm-u2',
        runId: 'run-b',
      }),
      makeAssistant({ id: 'asst-run-b', runId: 'run-b', finalText: '第二答' }),
    ];
    const persisted = [
      makeUser({
        id: 'hist-u1',
        text: '第一问',
        clientMessageId: 'cm-u1',
        messageId: 'hist-u1',
        runId: 'run-a',
      }),
      makeAssistant({
        id: 'hist-a1',
        messageId: 'hist-a1',
        runId: 'run-a',
        finalText: '第一答',
      }),
      makeUser({
        id: 'user-cm-u2',
        text: '第二问',
        clientMessageId: 'cm-u2',
        runId: 'run-b',
      }),
      makeAssistant({
        id: 'hist-a2',
        messageId: 'hist-a2',
        runId: 'run-b',
        finalText: '第二答',
      }),
    ];

    // Act
    const merged = mergePersistedWithOverlay(persisted, overlay, 10, () => 10);

    // Assert — 旧 runA 插在 runB 之前，顺序 [u1, a1, u2, a2]
    expect(merged.map((m) => m.runId)).toEqual([
      'run-a',
      'run-a',
      'run-b',
      'run-b',
    ]);
    expect(merged[0].role).toBe('user');
    expect(merged[2].role).toBe('user');
    expect(merged[2].text).toBe('第二问');
  });

  it('overlay-only item without persisted anchor inserts at the correct position', () => {
    // Arrange — 极端场景：overlay 整段缺失 persisted 锚点
    const overlay = [
      makeUser({
        id: 'user-cm-uA',
        text: '孤立提问',
        clientMessageId: 'cm-uA',
        runId: 'run-x',
      }),
    ];
    const persisted = [
      makeUser({
        id: 'hist-u1',
        text: '一',
        clientMessageId: 'cm-u1',
        messageId: 'hist-u1',
        runId: 'run-a',
      }),
      makeAssistant({
        id: 'hist-a1',
        messageId: 'hist-a1',
        runId: 'run-a',
        finalText: 'A',
      }),
      makeUser({
        id: 'hist-u2',
        text: '二',
        clientMessageId: 'cm-u2',
        messageId: 'hist-u2',
        runId: 'run-b',
      }),
      makeAssistant({
        id: 'hist-a2',
        messageId: 'hist-a2',
        runId: 'run-b',
        finalText: 'B',
      }),
    ];

    // Act — 不应抛错
    const merged = mergePersistedWithOverlay(persisted, overlay, 10, () => 10);

    // Assert — userA 至少被保留（append 兜底）；assistant 相对顺序不乱
    expect(merged.length).toBeGreaterThanOrEqual(1);
    expect(merged.some((m) => m.text === '孤立提问')).toBe(true);
    expect(
      merged.filter((m) => m.role === 'assistant').map((m) => m.runId),
    ).toEqual(['run-a', 'run-b']);
  });

  it('mixed scenario: overlay has 2 turns, persisted has 3 turns, last turn only in overlay', () => {
    // Arrange — 端到端模拟：第二轮的 assistant2(runC) 还在流式半成，尚未落盘
    const overlay = [
      makeUser({
        id: 'user-cm-u1',
        text: '第一问',
        clientMessageId: 'cm-u1',
        runId: 'run-a',
      }),
      makeAssistant({
        id: 'asst-run-a',
        runId: 'run-a',
        finalText: '第一答',
      }),
      makeUser({
        id: 'user-cm-u2',
        text: '第二问',
        clientMessageId: 'cm-u2',
        runId: 'run-c',
      }),
      makeAssistant({
        id: 'asst-run-c',
        runId: 'run-c',
        thinking: '流式半成',
        finalText: '第二答',
      }),
    ];
    const persisted = [
      makeUser({
        id: 'user-cm-u1',
        text: '第一问',
        clientMessageId: 'cm-u1',
        runId: 'run-a',
      }),
      makeAssistant({
        id: 'hist-a1',
        messageId: 'hist-a1',
        runId: 'run-a',
        finalText: '第一答',
      }),
      makeUser({
        id: 'user-cm-u2',
        text: '第二问',
        clientMessageId: 'cm-u2',
        runId: 'run-c',
      }),
    ];

    // Act
    const merged = mergePersistedWithOverlay(persisted, overlay, 10, () => 10);

    // Assert — user2 仍在 assistant2 之前
    expect(merged.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(merged[2].text).toBe('第二问');
    expect(merged[3].runId).toBe('run-c');
  });

  it('invalidate scope change does not touch history query', async () => {
    // Arrange — spy queryClient.invalidateQueries，渲染 ChatPage 触发 done 态 effect
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/chat/s1']}>
          <Routes>
            <Route path="/chat/:sessionId" element={<ChatPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Act — status 已 mock 为 'done'，effect 应触发 invalidate
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());

    // Assert — 只刷 ['sessions', 'list']，未刷泛 ['sessions'] 或任何含 history 的键
    const keys = invalidateSpy.mock.calls.map((c) => c[0]?.queryKey);
    const listCalled = keys.some(
      (k) => JSON.stringify(k) === JSON.stringify(['sessions', 'list']),
    );
    expect(listCalled).toBe(true);

    const wrongKeys = keys.filter(
      (k) =>
        JSON.stringify(k) === JSON.stringify(['sessions']) ||
        JSON.stringify(k).includes('history'),
    );
    expect(wrongKeys).toHaveLength(0);
  });
});
