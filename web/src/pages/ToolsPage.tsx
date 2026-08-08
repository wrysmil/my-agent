import { useState } from 'react';
import { useTools, useToolDetail, type ToolSummary, type ToolDetail } from '@/features/tools/useTools';
import { X } from 'lucide-react';

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="tools-loading">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-lg border border-border bg-surface p-5">
          <div className="mb-3 h-5 w-2/3 rounded bg-border" />
          <div className="h-4 w-full rounded bg-border" />
          <div className="mt-2 h-4 w-4/5 rounded bg-border" />
        </div>
      ))}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-danger/30 bg-danger-bg p-8" data-testid="tools-error">
      <p className="mb-3 text-sm text-danger">{message}</p>
      <button onClick={onRetry} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:opacity-90">
        重试
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-12" data-testid="tools-empty">
      <p className="text-sm text-text-muted">暂无可用工具</p>
    </div>
  );
}

function DetailPanel({ tool, onClose }: { tool: ToolDetail; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/40" onClick={onClose}>
      <div className="bg-surface border border-border rounded-lg shadow-xl w-full max-w-2xl max-h-[70vh] flex flex-col m-4" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold">{tool.name}</h2>
            {tool.executionMode && (
              <span className="inline-block mt-1 rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-fg">
                {tool.executionMode}
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-surface-hover">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="text-sm text-text-muted mb-4">{tool.description}</p>
          <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Input Schema</h4>
          <pre className="text-sm whitespace-pre-wrap font-mono bg-bg rounded-md p-4 border border-border max-h-80 overflow-y-auto">
            {JSON.stringify(tool.inputSchema, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}

export function ToolsPage() {
  const { data: tools, isLoading, isError, error, refetch } = useTools();
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const {
    data: toolDetail,
    isLoading: detailLoading,
    isError: detailError,
  } = useToolDetail(selectedName ?? '', !!selectedName);

  // detail 404 → 自动关闭弹窗
  if (detailError && selectedName) {
    setSelectedName(null);
  }

  return (
    <div className="p-6" data-testid="page-tools">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-text">工具</h1>
        <p className="mt-1 text-sm text-text-muted">
          {tools ? `共 ${tools.length} 个工具` : '内置工具列表'}
        </p>
      </div>

      {/* Detail loading overlay */}
      {detailLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
          <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      )}

      {isLoading && <LoadingSkeleton />}
      {isError && (
        <ErrorState
          message={error instanceof Error ? error.message : '加载工具列表失败'}
          onRetry={() => refetch()}
        />
      )}
      {!isLoading && !isError && tools && tools.length === 0 && <EmptyState />}
      {!isLoading && !isError && tools && tools.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool: ToolSummary) => (
            <div
              key={tool.name}
              className="cursor-pointer rounded-lg border border-border bg-surface p-5 transition-shadow hover:shadow-md"
              onClick={() => setSelectedName(tool.name)}
              data-testid="tool-card"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-base font-semibold text-text">{tool.name}</h3>
                {tool.executionMode && (
                  <span className="shrink-0 rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-fg">
                    {tool.executionMode}
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-text-muted line-clamp-2">
                {tool.description || '无描述'}
              </p>
            </div>
          ))}
        </div>
      )}

      {toolDetail && selectedName && (
        <DetailPanel tool={toolDetail} onClose={() => setSelectedName(null)} />
      )}
    </div>
  );
}
