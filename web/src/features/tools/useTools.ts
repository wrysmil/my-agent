import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export interface ToolSummary {
  name: string;
  description: string;
  executionMode?: 'sequential' | 'parallel';
}

export interface ToolDetail {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  executionMode?: 'sequential' | 'parallel';
}

interface ToolsListResponse {
  tools: ToolSummary[];
}

interface ToolDetailResponse {
  tool: ToolDetail;
}

export function useTools() {
  return useQuery({
    queryKey: queryKeys.tools.all,
    queryFn: () => apiGet<ToolsListResponse>('/api/tools'),
    select: (data) => data.tools,
  });
}

export function useToolDetail(name: string, enabled: boolean = false) {
  return useQuery({
    queryKey: queryKeys.tools.detail(name),
    queryFn: () => apiGet<ToolDetailResponse>(`/api/tools/${name}`),
    select: (data) => data.tool,
    enabled,
  });
}
