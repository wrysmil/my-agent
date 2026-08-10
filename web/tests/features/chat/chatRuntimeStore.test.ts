/**
 * chatRuntimeStore 单元测试（P0）。
 *
 * 覆盖：
 * - Session 创建 / 隔离 / LRU
 * - Run 创建 / 删除 / 状态管理
 * - updateMessages 校验 sessionId + runId
 * - rAF buffer 按 run 隔离
 * - Session 删除级联清理
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useChatRuntimeStore, selectSessionMessages, selectSessionStatus } from '@/features/chat/chatRuntimeStore';

// 清理 store 状态
function resetStore() {
  const store = useChatRuntimeStore;
  store.setState({
    sessions: {},
    runs: {},
    _accessOrder: [],
  });
}

describe('chatRuntimeStore', () => {
  beforeEach(() => {
    resetStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ==========================================================
  // Session 操作
  // ==========================================================

  describe('ensureSession', () => {
    it('创建新的 SessionRuntime', () => {
      const { ensureSession, getSession } = useChatRuntimeStore.getState();
      ensureSession('A');
      const s = getSession('A');
      expect(s).toBeDefined();
      expect(s!.sessionId).toBe('A');
      expect(s!.messages).toEqual([]);
      expect(s!.status).toBe('idle');
      expect(s!.historyLoaded).toBe(false);
      expect(s!.activeRunId).toBeNull();
    });

    it('幂等：重复调用不覆盖已有数据', () => {
      const store = useChatRuntimeStore.getState();
      store.ensureSession('A');
      store.setSessionMessages('A', [{ id: 'm1', role: 'user', blocks: [], text: 'hello' }]);
      store.setSessionStatus('A', 'streaming');

      store.ensureSession('A'); // 幂等调用

      const s = store.getSession('A');
      expect(s!.messages).toHaveLength(1);
      expect(s!.status).toBe('streaming');
    });

    it('多个 session 独立存在', () => {
      const store = useChatRuntimeStore.getState();
      store.ensureSession('A');
      store.ensureSession('B');

      expect(store.getSession('A')).toBeDefined();
      expect(store.getSession('B')).toBeDefined();
      expect(store.getSession('A')!.sessionId).not.toBe(store.getSession('B')!.sessionId);
    });
  });

  describe('session 隔离', () => {
    it('A 的消息更新不影响 B', () => {
      const store = useChatRuntimeStore.getState();
      store.ensureSession('A');
      store.ensureSession('B');

      store.setSessionMessages('A', [{ id: 'a1', role: 'user', blocks: [], text: 'A msg' }]);
      store.setSessionMessages('B', [{ id: 'b1', role: 'user', blocks: [], text: 'B msg' }]);

      expect(store.getSession('A')!.messages[0].text).toBe('A msg');
      expect(store.getSession('B')!.messages[0].text).toBe('B msg');
    });

    it('A 的状态变更不影响 B', () => {
      const store = useChatRuntimeStore.getState();
      store.ensureSession('A');
      store.ensureSession('B');

      store.setSessionStatus('A', 'streaming');
      expect(store.getSession('A')!.status).toBe('streaming');
      expect(store.getSession('B')!.status).toBe('idle');
    });
  });

  describe('LRU 驱逐', () => {
    it('超过 MAX_CACHED_SESSIONS 时驱逐最久未访问的非当前 session', () => {
      const store = useChatRuntimeStore.getState();
      // 创建 22 个 session（MAX_CACHED_SESSIONS=20）
      // 第 21 个(s20)创建时：evictable=20 不大于 20，不触发
      // 第 22 个(s21)创建时：evictable=21 > 20 → 驱逐最旧的 s0
      for (let i = 0; i < 22; i++) {
        store.ensureSession(`s${i}`);
        store.setSessionStatus(`s${i}`, 'done');
      }

      // s0 在创建 s21 时已被驱逐（当时 evictable 21 > 20，s0 最旧）
      expect(store.getSession('s0')).toBeUndefined();
      // s1-s21 保留（20 个）
      expect(store.getSession('s1')).toBeDefined();
      expect(store.getSession('s21')).toBeDefined();
    });

    it('有 activeRun 的 session 不被驱逐', () => {
      // 直接通过 hook 获取方法以避免 stale closure
      const { ensureSession, setSessionStatus, createRun, setActiveRun, getSession } =
        useChatRuntimeStore.getState();

      // 创建 19 个 session
      for (let i = 0; i < 19; i++) {
        ensureSession(`s${i}`);
        setSessionStatus(`s${i}`, 'done');
      }

      // s0: 设置 active run（应被保护）
      createRun('s0', 'run-0');
      setActiveRun('s0', 'run-0');

      // 创建 s19-s21，触发驱逐（最多20 个非 active 的 session）
      ensureSession('s19');
      ensureSession('s20');
      ensureSession('s21');

      // s0 有 active run，受保护
      expect(getSession('s0')).toBeDefined();
    });
  });

  // ==========================================================
  // Run 操作
  // ==========================================================

  describe('createRun / removeRun', () => {
    it('创建新 run', () => {
      const store = useChatRuntimeStore.getState();
      store.createRun('A', 'run-1');

      const run = store.getRun('run-1');
      expect(run).toBeDefined();
      expect(run!.sessionId).toBe('A');
      expect(run!.runId).toBe('run-1');
      expect(run!.status).toBe('queued');
      expect(run!.lastSeq).toBe(-1);
    });

    it('删除 run 时清理 rAF', () => {
      const store = useChatRuntimeStore.getState();
      store.createRun('A', 'run-1');

      // 模拟有 rAF handle
      useChatRuntimeStore.setState((s) => ({
        runs: {
          ...s.runs,
          'run-1': { ...s.runs['run-1'], rafHandle: 42, rafScheduled: true },
        },
      }));

      store.removeRun('run-1');
      expect(store.getRun('run-1')).toBeUndefined();
    });

    it('run 状态变更', () => {
      const store = useChatRuntimeStore.getState();
      store.createRun('A', 'run-1');
      store.setRunStatus('run-1', 'running');

      expect(store.getRun('run-1')!.status).toBe('running');
    });
  });

  // ==========================================================
  // updateMessages 身份校验
  // ==========================================================

  describe('updateMessages', () => {
    it('activeRunId 匹配时更新消息', () => {
      const store = useChatRuntimeStore.getState();
      store.ensureSession('A');
      store.createRun('A', 'run-1');
      store.setActiveRun('A', 'run-1');
      store.setSessionMessages('A', [{ id: 'm1', role: 'user', blocks: [], text: 'hello' }]);

      store.updateMessages('A', 'run-1', (msgs) => [
        ...msgs,
        { id: 'm2', role: 'assistant', blocks: [] },
      ]);

      expect(store.getSession('A')!.messages).toHaveLength(2);
    });

    it('runId 不匹配时拒绝更新', () => {
      const store = useChatRuntimeStore.getState();
      store.ensureSession('A');
      store.createRun('A', 'run-1');
      store.setActiveRun('A', 'run-1');
      store.setSessionMessages('A', [{ id: 'm1', role: 'user', blocks: [], text: 'hello' }]);

      // run-2 不是 activeRunId → 更新被拒绝
      store.updateMessages('A', 'run-2', (msgs) => [
        ...msgs,
        { id: 'm2', role: 'assistant', blocks: [] },
      ]);

      expect(store.getSession('A')!.messages).toHaveLength(1); // 未变化
    });

    it('A 的 activeRun 更新不影响 B', () => {
      const store = useChatRuntimeStore.getState();
      store.ensureSession('A');
      store.ensureSession('B');
      store.createRun('A', 'run-a');
      store.setActiveRun('A', 'run-a');

      store.updateMessages('B', 'run-a', () => [
        { id: 'bx', role: 'assistant', blocks: [] },
      ]);

      expect(store.getSession('B')!.messages).toHaveLength(0); // B 无 activeRun，更新被忽略
    });
  });

  // ==========================================================
  // rAF 缓冲按 run 隔离
  // ==========================================================

  describe('rAF buffer 隔离', () => {
    it('appendTextBuffer 将文本写入指定 run', () => {
      const store = useChatRuntimeStore.getState();
      store.ensureSession('A');
      store.createRun('A', 'run-1');
      store.setActiveRun('A', 'run-1');
      store.setRunStatus('run-1', 'running');
      store.setSessionMessages('A', [
        { id: 'm1', role: 'user', blocks: [], text: 'hi' },
        { id: 'm2', role: 'assistant', blocks: [] },
      ]);

      store.appendTextBuffer('run-1', 'Hello');

      const run = store.getRun('run-1');
      expect(run!.pendingTextBuffer).toBe('Hello');
      expect(run!.rafScheduled).toBe(true);
    });

    it('flushTextBuffer 将 buffer 写入 assistant 消息', () => {
      const store = useChatRuntimeStore.getState();
      store.ensureSession('A');
      store.createRun('A', 'run-1');
      store.setActiveRun('A', 'run-1');
      store.setRunStatus('run-1', 'running');
      store.setSessionMessages('A', [
        { id: 'm1', role: 'user', blocks: [], text: 'hi' },
        { id: 'm2', role: 'assistant', blocks: [], runId: 'run-1' },
      ]);

      // 模拟 buffer 有内容
      useChatRuntimeStore.setState((s) => ({
        runs: {
          ...s.runs,
          'run-1': { ...s.runs['run-1'], pendingTextBuffer: 'World', rafScheduled: true },
        },
      }));

      store.flushTextBuffer('run-1');

      const msgs = store.getSession('A')!.messages;
      const lastMsg = msgs[msgs.length - 1];
      expect(lastMsg.role).toBe('assistant');
      expect(lastMsg.blocks.some((b) => b.type === 'text')).toBe(true);
    });

    it('非 running 状态的 run 不接受 buffer', () => {
      const store = useChatRuntimeStore.getState();
      store.createRun('A', 'run-1'); // status = 'queued'

      store.appendTextBuffer('run-1', 'Should be ignored');
      expect(store.getRun('run-1')!.pendingTextBuffer).toBe('');
    });

    it('A 的 buffer 不影响 B', () => {
      const store = useChatRuntimeStore.getState();
      store.ensureSession('A');
      store.ensureSession('B');
      store.createRun('A', 'run-a');
      store.createRun('B', 'run-b');
      store.setActiveRun('A', 'run-a');
      store.setActiveRun('B', 'run-b');
      store.setRunStatus('run-a', 'running');
      store.setRunStatus('run-b', 'running');

      store.appendTextBuffer('run-a', 'A content');

      // B 的 buffer 应保持空
      expect(store.getRun('run-b')!.pendingTextBuffer).toBe('');
      // A 的 buffer 应有内容
      expect(store.getRun('run-a')!.pendingTextBuffer).toBe('A content');
    });
  });

  // ==========================================================
  // seq 去重
  // ==========================================================

  describe('setRunLastSeq', () => {
    it('更新 lastSeq', () => {
      const store = useChatRuntimeStore.getState();
      store.createRun('A', 'run-1');
      store.setRunLastSeq('run-1', 5);

      expect(store.getRun('run-1')!.lastSeq).toBe(5);
    });

    it('拒绝小于等于当前 seq 的更新', () => {
      const store = useChatRuntimeStore.getState();
      store.createRun('A', 'run-1');
      store.setRunLastSeq('run-1', 5);
      store.setRunLastSeq('run-1', 5); // 重复
      store.setRunLastSeq('run-1', 3); // 更小

      expect(store.getRun('run-1')!.lastSeq).toBe(5);
    });

    it('接受递增 seq', () => {
      const store = useChatRuntimeStore.getState();
      store.createRun('A', 'run-1');
      store.setRunLastSeq('run-1', 5);
      store.setRunLastSeq('run-1', 10);

      expect(store.getRun('run-1')!.lastSeq).toBe(10);
    });
  });

  // ==========================================================
  // Session 删除级联清理
  // ==========================================================

  describe('removeSession', () => {
    it('删除 session 时 abort active run', () => {
      const store = useChatRuntimeStore.getState();
      store.ensureSession('A');
      const ac = new AbortController();
      store.createRun('A', 'run-1');
      store.setRunAbortController('run-1', ac);
      store.setActiveRun('A', 'run-1');

      store.removeSession('A');

      expect(store.getSession('A')).toBeUndefined();
      expect(store.getRun('run-1')).toBeUndefined();
      expect(ac.signal.aborted).toBe(true);
    });

    it('删除无 active run 的 session', () => {
      const store = useChatRuntimeStore.getState();
      store.ensureSession('A');
      store.removeSession('A');
      expect(store.getSession('A')).toBeUndefined();
    });
  });

  // ==========================================================
  // selectors
  // ==========================================================

  describe('selectors', () => {
    it('selectSessionMessages 返回空数组（session 不存在）', () => {
      const state = useChatRuntimeStore.getState();
      expect(selectSessionMessages('nonexistent')(state)).toEqual([]);
    });

    it('selectSessionStatus 返回 idle（session 不存在）', () => {
      const state = useChatRuntimeStore.getState();
      expect(selectSessionStatus('nonexistent')(state)).toBe('idle');
    });
  });
});
