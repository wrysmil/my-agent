import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useChatStream } from '@/features/chat/useChatStream';
import type { ChatOptions } from '@/features/chat/types';
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

  // Auto-create session when no sessionId provided
  useEffect(() => {
    if (sessionId) return;
    let cancelled = false;
    setCreating(true);
    apiPost<{ session: { id: string } }>('/api/sessions', { kind: 'gconv' })
      .then((data) => {
        if (!cancelled) {
          logger.debug(`📝 新建会话: ${data.session.id}`);
          // 刷新侧边栏 session 列表
          queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
          // 记录活跃 session 到 localStorage，便于恢复
          try { localStorage.setItem('my-agent.activeSession', data.session.id); } catch {}
          navigate(`/chat/${data.session.id}`, { replace: true });
        }
      })
      .catch(() => {
        if (!cancelled) setCreating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, navigate]);

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

  // Set default model once active provider is loaded
  useEffect(() => {
    if (activeProvider?.defaultModel && !selectedModel) {
      setSelectedModel(activeProvider.defaultModel);
    }
  }, [activeProvider, selectedModel]);

  // Model label for current selection
  const selectedModelInfo = availableModels.find(m => m.id === selectedModel);

  const handleSend = useCallback(
    (text: string) => {
      const options: ChatOptions = {};
      if (selectedModel) options.model = selectedModel;
      if (thinkingLevel !== 'off') options.thinkingLevel = thinkingLevel;
      send(text, options);
    },
    [send, selectedModel, thinkingLevel],
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

  if (!sessionId) {
    return (
      <div className="flex flex-col h-full items-center justify-center" data-testid="page-chat">
        <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full mb-3" />
        <p className="text-sm text-text-muted">{creating ? t('chat.generating') : '正在准备...'}</p>
      </div>
    );
  }

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

      {/* Loading history indicator */}
      {!historyLoaded && (
        <div className="flex items-center justify-center py-2 bg-surface-hover/50 border-b border-border">
          <div className="animate-spin h-3 w-3 border-2 border-primary border-t-transparent rounded-full mr-2" />
          <span className="text-xs text-text-muted">加载历史消息...</span>
        </div>
      )}

      <MessageList messages={messages} status={status} />
      <Composer
        onSend={handleSend}
        onAbort={abort}
        status={status}
        modelSelector={modelSelector}
      />
    </div>
  );
}
