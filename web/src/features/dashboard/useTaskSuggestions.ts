/**
 * Dashboard 任务建议 hook。
 *
 * 来源：spec § 4.5 .ai-runtime-artifacts/specs/2026-08-09-chat-composer-redesign-spec.md
 * 落地：plan § Step 1.4
 *
 * 行为：
 *   1. 启动时尝试 GET /api/task-suggestions（5s timeout）
 *   2. 失败 / 404 / 5xx / 超时 → 静默回落到 TASK_SUGGESTIONS 常量（**不** toast，避免噪音）
 *   3. 成功 → 用服务端数组替换
 *   4. 返回 { suggestions, source }
 *
 * 本期 endpoint 未实装，**永远回落到常量**；hook 已完整写好，等后端补 endpoint 自动生效。
 */

import { useQuery } from '@tanstack/react-query';
import {
  TASK_SUGGESTIONS,
  type TaskSuggestion,
} from './taskSuggestions';

const REMOTE_TIMEOUT_MS = 5000;

export interface UseTaskSuggestionsResult {
  suggestions: readonly TaskSuggestion[];
  source: 'remote' | 'fallback';
}

interface RemoteResponse {
  suggestions: TaskSuggestion[];
}

/**
 * 内部 fetch 函数（不走 apiGet — apiGet 当前不接受 options）。
 * 5s 超时由 AbortController 控制；TanStack Query signal 也用于取消。
 */
async function fetchRemote(
  url: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<TaskSuggestion[]> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  // 链接 TanStack Query 的 signal（取消时也 abort 内部 fetch）
  const onOuterAbort = () => ac.abort();
  signal.addEventListener('abort', onOuterAbort, { once: true });

  try {
    const res = await fetch(url, { signal: ac.signal, credentials: 'same-origin' });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = (await res.json()) as RemoteResponse;
    if (!Array.isArray(data.suggestions)) {
      throw new Error('Invalid response shape: suggestions is not array');
    }
    return data.suggestions;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onOuterAbort);
  }
}

export function useTaskSuggestions(): UseTaskSuggestionsResult {
  const query = useQuery<TaskSuggestion[]>({
    queryKey: ['task-suggestions'],
    queryFn: ({ signal }) => fetchRemote('/api/task-suggestions', REMOTE_TIMEOUT_MS, signal),
    staleTime: 60_000,
    retry: false,
  });

  if (query.data) {
    return { suggestions: query.data, source: 'remote' };
  }
  return { suggestions: TASK_SUGGESTIONS, source: 'fallback' };
}