// ============================================================
// 工具上下文
// ============================================================
export type ToolContext = {
  /** 工作目录（文件工具根路径）。 */
  workingDir?: string;
  /** 中止信号（用户点停止按钮）。 */
  signal?: AbortSignal;
  /** 长时工具仍在执行时发出用户可见的进度。 */
  emitProgress?: (progress: ToolProgress) => void;
  /** 跨工具调用持久化的任意状态。 */
  state: Record<string, unknown>;
};

export type ToolProgress = {
  phase?: string;
  message: string;
  data?: Record<string, unknown>;
};

// ============================================================
// 工具结果
// ============================================================
export type ToolResult = {
  content: string;
  /** 仅宿主可见的元数据：超大结果持久化在模型上下文之外。 */
  persistedOutput?: { path: string; size: number; ref: string };
  isError?: boolean;
  /** 终止型工具：提交此结果后结束 run，不做后续推理。 */
  endTurn?: boolean;
};

// ============================================================
// 工具接口
// ============================================================
export interface AgentTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly executionMode?: "sequential" | "parallel";
  execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

// ============================================================
// Provider 工具描述格式
// ============================================================
export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export function toToolDefinition(tool: AgentTool): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description.replace(/\s+/g, " ").trim(),
    inputSchema: tool.inputSchema,
  };
}

// ============================================================
// defineTool() 工厂
// ============================================================
export function defineTool(opts: {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  executionMode?: "sequential" | "parallel";
  execute: (
    input: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<ToolResult>;
}): AgentTool {
  return {
    name: opts.name,
    description: opts.description,
    inputSchema: opts.inputSchema,
    // 不指定 executionMode 时属性为 undefined（默认 sequential）
    ...(opts.executionMode ? { executionMode: opts.executionMode } : {}),
    execute: opts.execute,
  };
}
