import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useChatStream, type ChatOptions } from '@/features/chat/useChatStream';
import { Composer } from '@/components/chat/Composer';
import { MessageList } from '@/components/chat/MessageList';
import { StreamIndicator } from '@/components/chat/StreamIndicator';
import { apiGet, apiPost } from '@/lib/api';
import { ChevronDown, Brain, Cpu, RefreshCw } from 'lucide-react';

interface ModelInfo {
  id: string;
  provider: string;
  model: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsStreaming: boolean;
}

const EFFORT_LEVELS = [
  { value: 'off', label: '关闭思考' },
  { value: 'low', label: '低' },
  { value: 'high', label: '高' },
] as const;

export function ChatPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  // Model & effort state
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [thinkingLevel, setThinkingLevel] = useState<'off' | 'low' | 'high'>('off');
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showEffortMenu, setShowEffortMenu] = useState(false);

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

  // Set default model once active provider is loaded
  useEffect(() => {
    if (activeProvider?.defaultModel && !selectedModel) {
      setSelectedModel(activeProvider.defaultModel);
    }
  }, [activeProvider, selectedModel]);

  // Model label for current selection
  const selectedModelInfo = availableModels.find(m => m.id === selectedModel);
  const modelLabel = selectedModelInfo?.model || selectedModel || activeProvider?.defaultModel || '选择模型';

  const handleSend = useCallback(
    (text: string) => {
      const options: ChatOptions = {};
      if (selectedModel) options.model = selectedModel;
      if (thinkingLevel !== 'off') options.thinkingLevel = thinkingLevel;
      send(text, options);
    },
    [send, selectedModel, thinkingLevel],
  );

  // Close popups on outside click
  useEffect(() => {
    if (!showModelMenu && !showEffortMenu) return;
    const handler = () => {
      setShowModelMenu(false);
      setShowEffortMenu(false);
    };
    window.addEventListener('click', handler, { once: true });
    return () => window.removeEventListener('click', handler);
  }, [showModelMenu, showEffortMenu]);

  if (!sessionId) {
    return (
      <div className="flex flex-col h-full items-center justify-center" data-testid="page-chat">
        <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full mb-3" />
        <p className="text-sm text-text-muted">{creating ? '创建会话中...' : '正在准备...'}</p>
      </div>
    );
  }

  // Model selector UI (moved to Composer area)
  const modelSelector = (
    <>
      {/* Model selector */}
      <div className="relative">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setShowModelMenu(v => !v); setShowEffortMenu(false); }}
          className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-surface-hover transition-colors"
        >
          <Cpu className="w-3 h-3 text-text-muted" />
          <span className="text-text-muted">{modelLabel}</span>
          <ChevronDown className="w-3 h-3 text-text-muted" />
        </button>
        {showModelMenu && (
          <div
            className="absolute bottom-full left-0 mb-1 z-50 rounded-md border border-border bg-surface shadow-lg py-1 min-w-[180px]"
            onClick={(e) => e.stopPropagation()}
          >
            {availableModels.length === 0 ? (
              <div className="px-3 py-2 text-xs text-text-muted">暂无可用模型</div>
            ) : (
              availableModels.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => { setSelectedModel(m.id); setShowModelMenu(false); }}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-surface-hover ${selectedModel === m.id ? 'text-primary font-medium' : 'text-text-muted'}`}
                >
                  <span>{m.model}</span>
                  <span className="ml-2 text-text-muted/50">{m.provider}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Thinking effort selector */}
      <div className="relative">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setShowEffortMenu(v => !v); setShowModelMenu(false); }}
          className={`flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs hover:bg-surface-hover transition-colors ${thinkingLevel !== 'off' ? 'border-accent text-accent-fg' : 'border-border'}`}
        >
          <Brain className="w-3 h-3" />
          <span className={thinkingLevel !== 'off' ? 'text-accent-fg' : 'text-text-muted'}>
            {thinkingLevel === 'off' ? '思考' : EFFORT_LEVELS.find(e => e.value === thinkingLevel)?.label}
          </span>
          <ChevronDown className="w-3 h-3 text-text-muted" />
        </button>
        {showEffortMenu && (
          <div
            className="absolute bottom-full left-0 mb-1 z-50 rounded-md border border-border bg-surface shadow-lg py-1 min-w-[140px]"
            onClick={(e) => e.stopPropagation()}
          >
            {EFFORT_LEVELS.map((level) => (
              <button
                key={level.value}
                type="button"
                onClick={() => { setThinkingLevel(level.value); setShowEffortMenu(false); }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-surface-hover ${thinkingLevel === level.value ? 'text-primary font-medium' : 'text-text-muted'}`}
              >
                {level.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="flex flex-col h-full" data-testid="page-chat">
      {/* Header — simplified: just title + status */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-surface">
        <h2 className="text-sm font-medium text-text-muted shrink-0">
          会话
        </h2>

        {/* Status indicator */}
        <div className="flex-1" />
        {status === 'streaming' && <StreamIndicator />}
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

      <MessageList messages={messages} />
      <Composer
        onSend={handleSend}
        onAbort={abort}
        status={status}
        modelSelector={modelSelector}
      />
    </div>
  );
}
