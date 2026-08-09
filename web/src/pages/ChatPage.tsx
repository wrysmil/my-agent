import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useChatStream } from '@/features/chat/useChatStream';
import type { ChatOptions } from '@/features/chat/types';
import {
  setPendingMessage,
  takePendingMessage,
} from '@/features/chat/pending-message';
import { useTranslation } from '@/i18n/useTranslation';
import { Composer } from '@/components/chat/Composer';
import { MessageList } from '@/components/chat/MessageList';
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
  // 即使用 useChatStream 的 status 已经变 'aborted' / 'error'，textarea 仍永久 disabled，
  // 「点停止后无法输入」的卡死就是这么来的。
  useEffect(() => {
    if (!creating) return;
    if (status === 'aborted' || status === 'error') {
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

  // 「懒创建」之后：新 ChatPage 实例拿到新 sessionId → 历史加载完 → 触发 pending send
  useEffect(() => {
    if (!sessionId || !historyLoaded) return;
    const pending = takePendingMessage(sessionId);
    if (!pending) return;
    const opts: ChatOptions = {};
    if (selectedModel) opts.model = selectedModel;
    if (thinkingLevel !== 'off') opts.thinkingLevel = thinkingLevel;
    logger.debug(`📤 续发首条消息 → ${sessionId}`);
    sendRef.current(pending, opts);
  }, [sessionId, historyLoaded, selectedModel, thinkingLevel]);

  const handleSend = useCallback(
    async (text: string) => {
      const options: ChatOptions = {};
      if (selectedModel) options.model = selectedModel;
      if (thinkingLevel !== 'off') options.thinkingLevel = thinkingLevel;

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
        logger.debug(`� 懒创建会话: ${newId}（由首条消息触发）`);
        queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
        try { localStorage.setItem('my-agent.activeSession', newId); } catch {}
        // 把待发送文本存进模块级 Map，新 mount 的 ChatPage 会接住
        setPendingMessage(newId, text);
        navigate(`/chat/${newId}`, { replace: true });
        // 注意：不在此处调用 send，因为当前 useChatStream 绑的是旧 cid。
        // 路由跳转后，新实例的 effect 会消费 pending 并触发真正的发送。
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

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="page-chat">
      {/* Header — simplified: just title + status */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-surface">
        <h2 className="text-sm font-medium text-text-muted shrink-0">
          {t('nav.chat')}
        </h2>

        {/* Status indicator */}
        <div className="flex-1" />
        {creating && !sessionId && (
          <span className="text-xs text-text-muted/60">{t('chat.generating')}</span>
        )}
        {status === 'streaming' && (
          <span className="text-xs text-text-muted/60">回复中...</span>
        )}
        {status === 'error' && (
          <button
            onClick={retry}
            className="flex items-center gap-1 text-xs text-danger hover:underline"
          >
            <RefreshCw className="w-3 h-3" />
            重试
          </button>
        )}
      </div>

      {/* Loading history indicator (only when an existing session is loading) */}
      {sessionId && !historyLoaded && (
        <div className="flex items-center justify-center py-2 bg-surface-hover/50 border-b border-border">
          <div className="animate-spin h-3 w-3 border-2 border-primary border-t-transparent rounded-full mr-2" />
          <span className="text-xs text-text-muted">加载历史消息...</span>
        </div>
      )}

      <MessageList messages={messages} status={status} />
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
      />
    </div>
  );
}
