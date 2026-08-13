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
import {
  mergePersistedWithOverlay,
  messageText,
} from '../../../src/features/chat/useChatStream';
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

function makeAgent(opts: {
  id: string;
  runId: string;
  toolName?: string;
  actorName?: string;
  text?: string;
  isFinal?: boolean;
  status?: 'working' | 'done' | 'error';
}): ChatMessage {
  return {
    id: opts.id,
    role: 'agent',
    blocks: [],
    runId: opts.runId,
    ...(opts.toolName !== undefined ? { toolName: opts.toolName } : {}),
    ...(opts.actorName !== undefined ? { actorName: opts.actorName } : {}),
    ...(opts.text !== undefined ? { text: opts.text } : {}),
    ...(opts.isFinal !== undefined ? { isFinal: opts.isFinal } : {}),
    ...(opts.status !== undefined ? { status: opts.status } : {}),
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

  // ──────────────────────────────────────────────────────────────────────────
  // dispatch run refetch 收敛（WU-04 review-fix）
  // 背景：done 后 history refetch → parseHistoryMessages 重建 hist-agent-* 气泡 +
  // 终态 assistant（messageId=assistantMessageId）；overlay 为实时气泡产物
  // （等待 assistant#1 + 实时 agent 气泡 + dispatch_done 合成收尾 assistant#2）。
  // merge 必须：不重复 agent 气泡、收尾文本不双份、agent 归位 assistant#1 之后。
  // ──────────────────────────────────────────────────────────────────────────
  it('[dispatch_to refetch] 无重复 agent 气泡 · 收尾文本不双份 · agent 归位 assistant#1 之后', () => {
    const overlay = [
      makeUser({
        id: 'user-cm-u1',
        text: '请 Coder 写个 travel.html',
        clientMessageId: 'cm-u1',
        runId: 'run-1',
      }),
      // #1 等待态：dispatch_done 后 messageId 已清空（真实收尾气泡才持有 assistantMessageId）
      makeAssistant({ id: 'asst-run-1', runId: 'run-1', thinking: '等待态' }),
      // 实时 agent 气泡：id 与历史重建同构（hist-agent-${tool_use id}）
      makeAgent({
        id: 'hist-agent-tu1',
        runId: 'run-1',
        toolName: 'dispatch_to',
        actorName: 'Coder',
        text: '已写入 travel.html',
        isFinal: false,
        status: 'done',
      }),
      // #2 合成收尾气泡：done.messageId 已写入（= persisted 终态行 messageId）
      makeAssistant({
        id: 'blk-9',
        runId: 'run-b',
        messageId: 'asst-2',
        finalText: 'Coder 已完成，travel.html 已就绪。',
      }),
    ];
    const persisted = [
      makeUser({
        id: 'hist-u1',
        text: '请 Coder 写个 travel.html',
        clientMessageId: 'cm-u1',
        messageId: 'u1',
        runId: 'run-1',
      }),
      makeAssistant({
        id: 'hist-rnd1',
        messageId: 'rnd1',
        runId: 'run-1',
        thinking: '等待态',
      }),
      makeAgent({
        id: 'hist-agent-tu1',
        runId: 'run-1',
        toolName: 'dispatch_to',
        actorName: 'coder',
        text: '已写入 travel.html',
        isFinal: false,
        status: 'done',
      }),
      makeAssistant({
        id: 'hist-asst-2',
        messageId: 'asst-2',
        runId: 'run-1',
        finalText: 'Coder 已完成，travel.html 已就绪。',
      }),
    ];

    // Act
    const merged = mergePersistedWithOverlay(persisted, overlay, 10, () => 10);

    // Assert — 结构 [user, assistant#1, agent, assistant#2]
    expect(merged.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'agent',
      'assistant',
    ]);
    // 无重复 agent 气泡
    expect(merged.filter((m) => m.role === 'agent')).toHaveLength(1);
    // agent 归位 assistant#1 之后
    const firstAssistantIdx = merged.findIndex((m) => m.role === 'assistant');
    const agentIdx = merged.findIndex((m) => m.role === 'agent');
    expect(agentIdx).toBe(firstAssistantIdx + 1);
    // agent 文本仅一份
    expect(
      merged
        .filter((m) => m.role === 'agent')
        .map((m) => messageText(m)),
    ).toEqual(['已写入 travel.html']);
    // 收尾文本只出现一次，且在最后一条 assistant（#2）；#1 等待气泡不吞收尾文本
    const closingText = 'Coder 已完成，travel.html 已就绪。';
    expect(merged.filter((m) => messageText(m) === closingText)).toHaveLength(1);
    expect(messageText(merged[merged.length - 1])).toBe(closingText);
    expect(messageText(merged[1])).not.toContain('Coder 已完成');
  });

  it('[dispatch_to refetch] overlay 实时 agent id 不稳定（blk-N）时按 runId+toolName 兜底去重', () => {
    // Arrange — 与上一用例同构，但 overlay 实时 agent 气泡 id 为不稳定 blk-N
    //（模拟 dispatch_started 时无法回查 tool_use id 的兜底场景）
    const overlay = [
      makeUser({
        id: 'user-cm-u1',
        text: '请 Coder 写个 travel.html',
        clientMessageId: 'cm-u1',
        runId: 'run-1',
      }),
      makeAssistant({ id: 'asst-run-1', runId: 'run-1', thinking: '等待态' }),
      makeAgent({
        id: 'blk-3',
        runId: 'run-1',
        toolName: 'dispatch_to',
        actorName: 'Coder',
        text: '已写入 travel.html',
        status: 'done',
      }),
      makeAssistant({
        id: 'blk-9',
        runId: 'run-b',
        messageId: 'asst-2',
        finalText: 'Coder 已完成，travel.html 已就绪。',
      }),
    ];
    const persisted = [
      makeUser({
        id: 'hist-u1',
        text: '请 Coder 写个 travel.html',
        clientMessageId: 'cm-u1',
        messageId: 'u1',
        runId: 'run-1',
      }),
      makeAssistant({
        id: 'hist-rnd1',
        messageId: 'rnd1',
        runId: 'run-1',
        thinking: '等待态',
      }),
      makeAgent({
        id: 'hist-agent-tu1',
        runId: 'run-1',
        toolName: 'dispatch_to',
        actorName: 'coder',
        text: '已写入 travel.html',
        isFinal: false,
        status: 'done',
      }),
      makeAssistant({
        id: 'hist-asst-2',
        messageId: 'asst-2',
        runId: 'run-1',
        finalText: 'Coder 已完成，travel.html 已就绪。',
      }),
    ];

    // Act
    const merged = mergePersistedWithOverlay(persisted, overlay, 10, () => 10);

    // Assert — 仍不产生重复 agent；收尾文本不双份
    expect(merged.filter((m) => m.role === 'agent')).toHaveLength(1);
    expect(merged.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'agent',
      'assistant',
    ]);
    const closingText = 'Coder 已完成，travel.html 已就绪。';
    expect(merged.filter((m) => messageText(m) === closingText)).toHaveLength(1);
    // 归并后吸收 persisted 稳定 id
    expect(
      merged.filter((m) => m.role === 'agent').map((m) => m.id),
    ).toEqual(['hist-agent-tu1']);
  });
});
