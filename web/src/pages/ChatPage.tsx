import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useChatStream } from '@/features/chat/useChatStream';
import type { ChatOptions } from '@/features/chat/types';
import type { AttachmentDraft } from '@/features/attachments/validateAttachment';
import {
  setPendingMessage,
  takePendingMessage,
} from '@/features/chat/pending-message';
import { useTranslation } from '@/i18n/useTranslation';
import { Composer } from '@/components/chat/Composer';
import { MessageList } from '@/components/chat/MessageList';
import { TaskSuggestionsGrid } from '@/features/dashboard/TaskSuggestionsGrid';
import type { TaskSuggestion } from '@/features/dashboard/taskSuggestions';
import { apiGet, apiPost } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { logger } from '@/lib/logger';
import { ChevronDown, RefreshCw, Sparkles, Brain } from 'lucide-react';

interface ModelInfo {
  id: string;
  provider: string;
  model: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsStreaming: boolean;
}

type Effort = 'off' | 'low' | 'medium' | 'high';
const EFFORT_VALUES: Effort[] = ['off', 'low', 'medium', 'high'];
const EFFORT_LEVELS_SHORT: Record<Effort, string> = {
  off: 'OFF',
  low: 'LOW',
  medium: 'MED',
  high: 'HIGH',
};

export function getGreetingKey(hour: number): 'morning' | 'afternoon' | 'evening' {
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

export function ChatPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  // creating：标记「首条消息触发懒创建会话」的进行中态，渲染上禁用 Composer 输入
  const [creating, setCreating] = useState(false);

  // Model & effort state
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [thinkingLevel, setThinkingLevel] = useState<Effort>('medium');
  const [showModelMenu, setShowModelMenu] = useState(false);

  // Fetch available models from API
  const { data: modelsData } = useQuery({
    queryKey: ['models'],
    queryFn: () => apiGet<{ models: ModelInfo[] }>('/api/models').catch(() => ({ models: [] })),
    staleTime: 60_000,
  });
  const availableModels: ModelInfo[] = modelsData?.models ?? [];

  // Fetch active provider to know default model
  const { data: activeProvider } = useQuery({
    queryKey: ['active-provider'],
    queryFn: () => apiGet<any>('/api/providers/active').catch(() => null),
    staleTime: 60_000,
  });

  // cid：传给 useChatStream。无 sessionId 时为空串，hook 内部 useEffect 会跳过。
  const cid = sessionId || '';
  const { status, messages, send, abort, retry, historyLoaded } = useChatStream(cid);

  // 当进入已有 session 时，更新 localStorage 记录
  useEffect(() => {
    if (sessionId) {
      try { localStorage.setItem('my-agent.activeSession', sessionId); } catch {}
    }
  }, [sessionId]);

  // 聊天完成后刷新侧边栏 session 列表（更新名称/消息数）
  useEffect(() => {
    if (status === 'done' || status === 'error' || status === 'aborted') {
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
    }
  }, [status, queryClient]);

  // 「懒创建」完成 / 被中止的兜底：
  // handleSend 走懒创建分支时 setCreating(true)，但无论 POST /api/sessions 成功还是
  // 失败，creating 必须最终被释放。否则在这段窗口里，Composer 的 prop status 永远是
  // 'submitting'（看下方 <Composer status={creating ? 'submitting' : status} />），
  // 即使用 useChatStream 的 status 已经变 'done' / 'aborted' / 'error'，
  // textarea 仍永久 disabled，「发完消息无法继续输入」就是这么来的。
  useEffect(() => {
    if (!creating) return;
    // 任何"非进行中"的状态都应释放 creating：
    // - done/aborted/error: 流结束
    if (status !== 'idle' && status !== 'submitting' && status !== 'streaming' && status !== 'reconnecting') {
      setCreating(false);
    }
  }, [creating, status]);

  // Set default model once active provider is loaded
  useEffect(() => {
    if (activeProvider?.defaultModel && !selectedModel) {
      setSelectedModel(activeProvider.defaultModel);
    }
  }, [activeProvider, selectedModel]);

  // 让 handleSend 拿到「最新」的 options 快照（避免闭包陈旧）
  const sendRef = useRef(send);
  useEffect(() => { sendRef.current = send; }, [send]);

  /**
   * 消费 pending-message：把 prompt 填入 Composer textarea，或自动发送。
   *
   * 触发场景：
   *   1. 懒创建会话 → setPendingMessage(newId, text, { autoSend: true, options })
   *      navigate → 新 ChatPage mount → 此 effect 自动调用 send() 发送
   *   2. Dashboard 任务卡跳转 → setPendingMessage('__dashboard__', prompt)
   *      → 填入 Composer textarea（不自动发送）
   *   3. 会话续发 → setPendingMessage(sessionId, text) → 填入 Composer textarea
   */
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId || !historyLoaded) return;
    const entry = takePendingMessage(sessionId);
    if (!entry) return;
    if (entry.autoSend) {
      // 懒创建会话：自动发送消息（无需用户再点一次发送按钮）
      logger.debug(`🚀 懒创建后自动发送（session=${sessionId}）`);
      sendRef.current(entry.text, entry.options);
    } else {
      // 会话续发：仅填入 textarea
      logger.debug(`📥 把 pending prompt 填入 Composer（session=${sessionId}）`);
      setPendingPrompt(entry.text);
    }
  }, [sessionId, historyLoaded]);

  // 「dashboard 任务卡跳转」专用：sessionId 为空，historyLoaded 也是 false
  // → 上面 effect 跳过 → 单独消费 '__dashboard__' 这份
  useEffect(() => {
    if (sessionId) return;
    const entry = takePendingMessage('__dashboard__');
    if (!entry) return;
    logger.debug(`📥 把 dashboard pending prompt 填入 Composer`);
    setPendingPrompt(entry.text);
  }, [sessionId]);

  /**
   * 任务卡片被点：直接把 prompt 填入当前 Composer（不自动发送）。
   *
   * 因为已经在 /chat 路由上，不需要 navigate，也不需要 setPendingMessage。
   */
  const handlePickTask = (task: TaskSuggestion) => {
    setPendingPrompt(task.prompt);
  };

  const handleSend = useCallback(
    async (text: string, attachments: AttachmentDraft[]) => {
      const options: ChatOptions = {};
      if (selectedModel) options.model = selectedModel;
      if (thinkingLevel !== 'off') options.thinkingLevel = thinkingLevel;

      // 本期附件是 UI 占位：上传逻辑 stub，未接 API。
      // 仅在控制台记录一下，让「附件真的被消费」的体感存在。
      if (attachments.length > 0) {
        logger.debug(`📎 携带 ${attachments.length} 个附件（本期仅 UI 占位）`);
      }

      if (sessionId) {
        // 已存在会话 → 直接发
        send(text, options);
        return;
      }

      // 无会话：懒创建。Composer 在 creating=true 时已经禁用输入，
      // 但理论上 handleSend 仍可能被旧请求触发（极少见），再次短路。
      if (creating) return;
      setCreating(true);
      try {
        const data = await apiPost<{ session: { id: string } }>(
          '/api/sessions',
          { kind: 'gconv' },
        );
        const newId = data.session.id;
        logger.debug(`🆕 懒创建会话: ${newId}（由首条消息触发）`);
        queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
        try { localStorage.setItem('my-agent.activeSession', newId); } catch {}
        // 把待发送文本 + 选项存进模块级 Map，新 mount 的 ChatPage 会接住并自动发送
        setPendingMessage(newId, text, { autoSend: true, options });
        navigate(`/chat/${newId}`, { replace: true });
        // 注意：不在此处调用 send，因为当前 useChatStream 绑的是旧 cid。
        // 路由跳转后，新实例的 effect 会消费 pending 并自动调用 send()。
      } catch (err) {
        logger.error('❌ 创建会话失败', {
          error: err instanceof Error ? err.message : String(err),
        });
        setCreating(false);
      }
    },
    [sessionId, send, selectedModel, thinkingLevel, creating, navigate, queryClient],
  );

  // Close model popup on outside click
  useEffect(() => {
    if (!showModelMenu) return;
    const handler = () => {
      setShowModelMenu(false);
    };
    window.addEventListener('click', handler, { once: true });
    return () => window.removeEventListener('click', handler);
  }, [showModelMenu]);

  // Model label for current selection
  const selectedModelInfo = availableModels.find(m => m.id === selectedModel);

  // Model selector UI (moved to Composer area)
  const modelSelector = (
    <>
      {/* Model selector — prominent pill with gradient icon, check mark for selected */}
      <div className="relative">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setShowModelMenu(v => !v); }}
          className={`group flex items-center gap-2 h-7 pl-1 pr-2.5 rounded-full border bg-surface text-xs transition-all shadow-sm hover:shadow-md ${
            showModelMenu
              ? 'border-primary ring-2 ring-primary/20'
              : 'border-border hover:border-primary/50'
          }`}
        >
          <span className="flex items-center justify-center w-5 h-5 rounded-full bg-gradient-to-br from-primary to-primary/70 text-primary-fg shrink-0 shadow-inner">
            <Sparkles className="w-3 h-3" />
          </span>
          <span className="font-semibold text-text truncate max-w-[140px]">
            {selectedModelInfo?.model ?? t('chat.model.placeholder')}
          </span>
          <ChevronDown className={`w-3 h-3 text-text-muted/70 shrink-0 transition-transform ${
            showModelMenu ? 'rotate-180 text-primary' : ''
          }`} />
        </button>
        {showModelMenu && (
          <div
            className="absolute bottom-full left-0 mb-2 z-50 rounded-xl border border-border bg-surface shadow-2xl py-1.5 min-w-[280px] max-h-80 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-text-muted/70">
              <Sparkles className="w-3 h-3" />
              {t('chat.model.label')}
            </div>
            <div className="border-t border-border/60" />
            {availableModels.length === 0 ? (
              <div className="px-3 py-3 text-xs text-text-muted">{t('chat.model.empty')}</div>
            ) : (
              availableModels.map((m) => {
                const isSelected = selectedModel === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => { setSelectedModel(m.id); setShowModelMenu(false); }}
                    className={`w-full flex items-center gap-2.5 pl-3 pr-3 py-2 text-xs hover:bg-surface-hover transition-colors text-left ${
                      isSelected ? 'bg-primary/8' : ''
                    }`}
                  >
                    <span className={`flex items-center justify-center w-6 h-6 rounded-lg shrink-0 transition-colors ${
                      isSelected
                        ? 'bg-primary text-primary-fg shadow-sm'
                        : 'bg-surface-hover text-text-muted'
                    }`}>
                      <Sparkles className="w-3 h-3" />
                    </span>
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className={`truncate w-full ${isSelected ? 'text-primary font-semibold' : 'text-text font-medium'}`}>
                        {m.model}
                      </span>
                      <span className="text-[10px] text-text-muted/70 mt-0.5">
                        {(m.contextWindow / 1024).toFixed(0)}k ctx · {m.provider}
                      </span>
                    </div>
                    {isSelected && (
                      <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-primary" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Thinking effort — prominent slider with thick filled track, large white thumb, tiered labels */}
      <div className="flex items-center gap-2.5 h-7 px-3 rounded-full border border-border bg-surface shadow-sm hover:border-primary/40 transition-colors">
        <Brain className={`w-3.5 h-3.5 shrink-0 ${thinkingLevel !== 'off' ? 'text-primary' : 'text-text-muted'}`} />
        <span className="text-[11px] font-semibold text-text shrink-0">
          {t('chat.thinking.label')}
        </span>
        <span className={`text-[11px] font-bold uppercase tracking-wide shrink-0 ${
          thinkingLevel !== 'off' ? 'text-primary' : 'text-text-muted/60'
        }`}>
          {EFFORT_LEVELS_SHORT[thinkingLevel]}
        </span>
        <div className="relative flex items-center select-none" style={{ width: 96 }}>
          {/* Filled progress background */}
          <div className="pointer-events-none absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-surface-hover overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-primary to-primary/70 rounded-full transition-[width] duration-200 ease-out"
              style={{ width: `${(EFFORT_VALUES.indexOf(thinkingLevel) / 3) * 100}%` }}
            />
          </div>
          {/* Stop dots overlay (on top of track, below thumb) */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-[7px] z-[1]">
            {[0, 1, 2, 3].map((i) => {
              const passed = i <= EFFORT_VALUES.indexOf(thinkingLevel);
              return (
                <span
                  key={i}
                  className={`block rounded-full transition-all duration-200 ${
                    passed
                      ? 'w-1.5 h-1.5 bg-white shadow-[0_0_0_2px_var(--color-primary,#6c5ce7)]'
                      : 'w-1.5 h-1.5 bg-text-muted/30'
                  }`}
                />
              );
            })}
          </div>
          <input
            type="range"
            min="0"
            max="3"
            step="1"
            value={EFFORT_VALUES.indexOf(thinkingLevel)}
            onChange={(e) => setThinkingLevel(EFFORT_VALUES[parseInt(e.target.value)])}
            aria-label={t('chat.thinking.label')}
            className="thinking-slider relative w-full appearance-none cursor-pointer z-[2]"
          />
        </div>
      </div>
    </>
  );

  // ── 是否显示任务栅格（代替 MessageList）──
  // 条件：无 sessionId（空白对话页）+ 无消息 + 非创建中
  const showTaskGrid = !sessionId && messages.length === 0 && !creating;

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="page-chat">
      {/* ── Header（Orkas chat-header 风格）──
          P1: 16px/600 标题 + 柔和状态指示器，顶部渐变装饰线 */}
      <div className="relative shrink-0 border-b border-border bg-surface">
        {/* 顶部渐变装饰线 */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-primary/60 via-primary/40 to-transparent" />
        <div className="flex items-center gap-3 px-5 py-3">
          <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary/10 text-primary shrink-0">
            <Sparkles className="w-3.5 h-3.5" />
          </span>
          <h2 className="text-[15px] font-semibold text-text tracking-tight">
            {sessionId ? t('nav.chat') : t('nav.chat')}
          </h2>

          <div className="flex-1" />
          {/* Status indicator — subtle pill */}
          {creating && !sessionId && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-text-muted/60 bg-surface-hover px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              {t('chat.generating')}
            </span>
          )}
          {status === 'streaming' && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-primary/80 bg-primary/5 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              回复中...
            </span>
          )}
          {status === 'error' && (
            <button
              onClick={retry}
              className="inline-flex items-center gap-1 text-[11px] text-danger bg-danger/5 hover:bg-danger/10 px-2.5 py-1 rounded-full transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              重试
            </button>
          )}
        </div>
      </div>

      {/* Loading history indicator (only when an existing session is loading) */}
      {sessionId && !historyLoaded && (
        <div className="flex items-center justify-center gap-3 py-3 bg-surface-hover/30 border-b border-border">
          <div className="animate-spin h-3.5 w-3.5 border-2 border-primary border-t-transparent rounded-full" />
          <span className="text-xs text-text-muted">加载历史消息...</span>
        </div>
      )}

      {/* ── 消息区 / 任务栅格 ──
          当 messages=[] 且无 sessionId（空白对话页）时显示任务栅格；
          否则显示 MessageList。 */}
      {showTaskGrid ? (
        <div className="flex-1 overflow-y-auto animate-fade-in">
          <div className="max-w-[960px] mx-auto w-full px-6 py-10">
            {/* 空白对话页问候语（Orkas .new-chat-header 风格） */}
            <div className="text-center mb-10">
              <h1
                className="text-[32px] font-semibold tracking-[-0.025em] text-text leading-tight"
                data-testid="chat-empty-greeting"
              >
                {t(`dashboard.greeting.${getGreetingKey(new Date().getHours())}`, { name: '' })}
              </h1>
              <p className="mt-2.5 text-[15px] text-text-muted leading-relaxed">
                {t('dashboard.subtitle')}
              </p>
            </div>
            <div className="animate-stagger">
              <TaskSuggestionsGrid onPick={handlePickTask} />
            </div>
          </div>
        </div>
      ) : (
        // ⚠️ min-h-0 + flex flex-col 让 MessageList（flex-1 overflow-y-auto）
        // 真正撑满剩余高度并可滚动；否则外层 flex-1 overflow-hidden
        // 加上中间 wrapper 没设 flex，会让 MessageList 的滚动失效。
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden animate-fade-in">
          <div className="flex-1 min-h-0 max-w-[860px] mx-auto w-full">
            <MessageList key={sessionId} messages={messages} status={status} />
          </div>
        </div>
      )}

      {/*
        Composer 的 `key` 跟随 sessionId：会话切换时强制重挂载，
        让输入框文本也跟着重置。否则从 /chat/:a → /chat（点 ➕），
        上一会话里没发出去的草稿文字会粘连到新会话里。
        与 useChatStream 的「sessionId 变化先清空 messages」配合，
        保证「点 ➕ 进入空白对话页面」的语义完整覆盖 messages + input。
      */}
      <Composer
        key={sessionId ?? '__blank__'}
        onSend={handleSend}
        onAbort={abort}
        status={creating ? 'submitting' : status}
        modelSelector={modelSelector}
        initialText={pendingPrompt ?? undefined}
        prominent={showTaskGrid}
      />
    </div>
  );
}
