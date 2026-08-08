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
import { ChevronDown, Brain, RefreshCw, Sparkles, Check } from 'lucide-react';

interface ModelInfo {
  id: string;
  provider: string;
  model: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsStreaming: boolean;
}

const EFFORT_LABELS: Record<string, string> = {
  off: '关闭思考',
  low: '低',
  medium: '中',
  high: '高',
};

const EFFORT_VALUES = ['off', 'low', 'medium', 'high'] as const;

export function ChatPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);

  // Model & effort state
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [thinkingLevel, setThinkingLevel] = useState<'off' | 'low' | 'medium' | 'high'>('medium');
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
      {/* Model selector — prominent pill with gradient icon + check for selected */}
      <div className="relative">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setShowModelMenu(v => !v); }}
          className={`group flex items-center gap-2 rounded-full border bg-surface pl-1 pr-2.5 py-1 text-xs transition-all shadow-sm hover:shadow-md ${
            showModelMenu
              ? 'border-primary ring-2 ring-primary/20'
              : 'border-border hover:border-primary/50'
          }`}
        >
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gradient-to-br from-primary to-primary/60 text-primary-fg shrink-0">
            <Sparkles className="w-3.5 h-3.5" />
          </span>
          <div className="flex flex-col items-start leading-none min-w-0">
            <span className="font-semibold text-text truncate max-w-[140px]">
              {selectedModelInfo?.model ?? t('chat.model.placeholder')}
            </span>
            {selectedModelInfo && (
              <span className="text-[10px] text-text-muted mt-0.5 truncate max-w-[140px]">
                {(selectedModelInfo.contextWindow / 1024).toFixed(0)}k ctx · {selectedModelInfo.provider}
              </span>
            )}
          </div>
          <ChevronDown className={`w-3.5 h-3.5 text-text-muted/70 transition-transform shrink-0 ${showModelMenu ? 'rotate-180 text-primary' : ''}`} />
        </button>
        {showModelMenu && (
          <div
            className="absolute bottom-full left-0 mb-2 z-50 rounded-xl border border-border bg-surface shadow-2xl py-1.5 min-w-[280px] max-h-72 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-text-muted/70 border-b border-border/60">
              <Sparkles className="w-3 h-3" />
              {t('chat.model.label')}
            </div>
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
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-surface-hover transition-colors ${
                      isSelected ? 'bg-primary/8' : ''
                    }`}
                  >
                    <span className={`flex items-center justify-center w-7 h-7 rounded-lg shrink-0 ${
                      isSelected
                        ? 'bg-primary text-primary-fg'
                        : 'bg-surface-hover text-text-muted'
                    }`}>
                      {isSelected ? <Check className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
                    </span>
                    <div className="flex flex-col items-start min-w-0 flex-1">
                      <span className={`truncate w-full ${isSelected ? 'text-primary font-semibold' : 'text-text font-medium'}`}>
                        {m.model}
                      </span>
                      <span className="text-[10px] text-text-muted/70 mt-0.5">
                        {(m.contextWindow / 1024).toFixed(0)}k ctx
                      </span>
                    </div>
                    <span className="shrink-0 rounded-full bg-surface-hover px-2 py-0.5 text-[10px] font-medium text-text-muted">
                      {m.provider}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Thinking effort slider — prominent track with filled progress, large white thumb */}
      <div className="flex items-center gap-2.5 rounded-full border border-border bg-surface px-3 py-1.5 shadow-sm hover:border-primary/50 transition-colors">
        <Brain className={`w-3.5 h-3.5 shrink-0 ${thinkingLevel !== 'off' ? 'text-accent' : 'text-text-muted'}`} />
        <span className="text-xs font-semibold text-text shrink-0">
          {t('chat.thinking.label')} ({EFFORT_LABELS[thinkingLevel]})
        </span>
        <div className="relative flex items-center" style={{ width: 88 }}>
          {/* Filled track background (segments between dots) */}
          <div className="pointer-events-none absolute inset-0 flex items-center px-[10px]">
            <div className="w-full h-1 rounded-full bg-border overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-accent to-accent/70 transition-all duration-200"
                style={{ width: `${(EFFORT_VALUES.indexOf(thinkingLevel) / 3) * 100}%` }}
              />
            </div>
          </div>
          <input
            type="range"
            min="0"
            max="3"
            step="1"
            value={EFFORT_VALUES.indexOf(thinkingLevel)}
            onChange={(e) => setThinkingLevel(EFFORT_VALUES[parseInt(e.target.value)] as typeof thinkingLevel)}
            className="thinking-slider w-full appearance-none cursor-pointer relative"
            aria-label={t('chat.thinking.label')}
          />
          {/* 4 stop dots overlay */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-[6px]">
            {[0, 1, 2, 3].map((i) => {
              const active = i <= EFFORT_VALUES.indexOf(thinkingLevel);
              return (
                <span
                  key={i}
                  className={`block rounded-full transition-all ${
                    active
                      ? 'w-1 h-1 bg-white shadow-[0_0_0_2px_var(--color-accent,#7c3aed)]'
                      : 'w-1.5 h-1.5 bg-surface-hover border border-border'
                  }`}
                />
              );
            })}
          </div>
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
