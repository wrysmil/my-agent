import type { Message, MessageContent } from "../shared/types.js";

// ============================================================
// HistoryResource — 会话中引用的持久资源
// ============================================================

/**
 * 经宿主侧验证的持久资源引用。
 *
 * 与单次消息中的附件不同，HistoryResource 会跨轮次携带，
 * 不会随着上下文压缩而被自动丢弃。
 */
export type HistoryResource = {
  /**
   * 资源来源分类：
   * - `"attachment"` — 用户上传的附件（PDF、图片等）
   * - `"final_output"` — agent 上一轮的输出产物（生成的文件）
   * - `"explicit"` — 用户显式标记为"持久化"的资源（右键→固定到上下文）
   */
  kind: "attachment" | "final_output" | "explicit";
  /** 资源在宿主文件系统中的绝对或相对路径 */
  path: string;
  /** 用户或 agent 给资源的备注说明 */
  note?: string;
  /** MIME 类型，如 `"image/png"`、`"application/pdf"` */
  mediaType?: string;
  /** 资源的显示名称（不传则使用 path 的 basename） */
  name?: string;
  /** 关联的会话轮次 ID */
  sourceTurnId?: number;
};

// ============================================================
// ExecutionPlan — agent 执行计划
// ============================================================

/**
 * 执行计划步骤状态：
 * - `"pending"` — 尚未开始
 * - `"in_progress"` — 正在进行中（同时只能有一个）
 * - `"completed"` — 已完成（可附带完成证据）
 * - `"blocked"` — 被阻塞（等待外部条件满足）
 */
export type ExecutionPlanStepStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "blocked";

/**
 * 执行计划中的单个步骤。
 *
 * agent 可通过 `TodoWrite` 等效工具将大任务分解为步骤列表，
 * Session 会自动追踪每个步骤的状态变更。
 */
export type ExecutionPlanStep = {
  /** 步骤序号（从 1 开始，自增） */
  id: number;
  /** 步骤描述文本 */
  step: string;
  /** 当前状态 */
  status: ExecutionPlanStepStatus;
  /**
   * 完成证据（仅 status=completed 时有值）：
   * - `verification: "observed"` — 通过工具输出确认完成
   * - `verification: "unverified"` — agent 声称完成但未验证
   * - `workEntryIds` — 关联的已完成工作条目 ID
   */
  completionEvidence?: {
    verification: "observed" | "unverified";
    workEntryIds: number[];
  };
};

/**
 * 执行计划的完整状态快照。
 *
 * 支持 JSON 序列化/反序列化，可用于跨 run 持久化。
 * `version` 字段用于未来格式兼容性。
 */
export type ExecutionPlanState = {
  /** 格式版本号 */
  version: 1;
  /** 任务目标描述 */
  objective: string;
  /** objective 是否因过长被截断 */
  objectiveTruncated?: boolean;
  /** objective 所在的轮次 ID */
  objectiveTurnId: number;
  /** 最后更新步骤状态的轮次 ID */
  updatedTurnId: number;
  /** 步骤列表（按顺序执行） */
  steps: ExecutionPlanStep[];
};

// ============================================================
// CompletedWork — 已完成工作账本
// ============================================================

/**
 * 已完成工作的状态分类：
 * - `"succeeded"` — 成功完成
 * - `"failed"` — 执行失败
 * - `"aborted"` — 被用户中止
 * - `"stalled"` — 超时/无响应
 * - `"skipped"` — 因终止工具或上限被跳过
 */
export type CompletedWorkStatus = "succeeded" | "failed" | "aborted" | "stalled" | "skipped";

/** 已完成工作的输入参数 */
export type CompletedWorkInput = {
  /** 关联的工具调用 ID（用于回溯 tool result） */
  toolCallId: string;
  /** 工具名称 */
  tool: string;
  /** 工具输入参数的摘要（用于去重和审计） */
  inputDigest: string;
  /** 人类可读的输入摘要 */
  inputSummary: string;
  /** 执行结果状态 */
  status: CompletedWorkStatus;
  /** 工具输出的文件引用（如果有） */
  resultRef?: string;
  /** 人类可读的结果摘要 */
  resultSummary?: string;
  /** 记录时的压缩周期编号 */
  checkpointEpoch?: number;
};

/** 已完成工作条目（含系统分配的 ID 和轮次 ID） */
export type CompletedWorkEntry = CompletedWorkInput & {
  /** 自增条目 ID */
  id: number;
  /** 记录时的轮次 ID */
  turnId?: number;
};

// ============================================================
// Compaction candidates — 压缩候选
// ============================================================

/**
 * 历史归档候选 — 可以被压缩为摘要的旧轮次。
 *
 * runner 通过 `Session.getPendingHistoryArchive()` 获取候选，
 * 然后用 LLM 生成摘要并调用 `applyHistorySummary()` 替换。
 */
export type HistoryArchiveCandidate = {
  /** 候选的轮次 ID 列表 */
  turnIds: number[];
  /** 这些轮次的原始 token 估算数 */
  rawTokens: number;
};

/**
 * 活跃检查点候选 — 可以被压缩的活跃处理上下文。
 *
 * 与历史归档不同，活跃检查点保留在上下文中但被压缩为结构化摘要，
 * 用于释放空间而不丢失关键信息。
 */
export type ActiveCheckpointCandidate = {
  /** 压缩周期编号 */
  epoch: number;
  /** 候选的原始 token 估算数 */
  rawTokens: number;
};

// ============================================================
// Session 类 — 会话状态管理器
// ============================================================

/**
 * 会话状态管理器。
 *
 * 负责维护与一次 agent 对话相关的所有状态：
 * - 对话历史（消息列表）
 * - 执行计划（步骤追踪）
 * - 已完成工作账本（审计日志）
 * - 轮次管理（turn 边界）
 * - 上下文压缩（compaction 候选）
 *
 * **多 run 共享：** 同一个 Session 实例可以在多个 `AgentRunner.run()` 调用间
 * 共享，实现多轮对话的上下文延续。
 *
 * @example
 * ```ts
 * const session = new Session();
 * // 第一轮
 * const runner1 = new AgentRunner({ config, session, tools });
 * await runner1.run({ message: "分析 package.json" });
 * // 第二轮 — 共享上下文
 * const runner2 = new AgentRunner({ config, session, tools });
 * await runner2.run({ message: "继续分析 tsconfig.json" });
 * ```
 */
export class Session {
  /** 对话消息列表（包含 user、assistant、tool_result 所有消息） */
  protected messages: Message[] = [];

  /** 当前轮次 ID（自增，从 1 开始） */
  protected turnId = 0;

  /** 执行计划状态（可选，agent 使用 TodoWrite 等工具时会设置） */
  private executionPlan: ExecutionPlanState | undefined;

  /** 已完成工作账本（按时间顺序追加） */
  private completedWork: CompletedWorkEntry[] = [];

  /** 工作条目 ID 计数器 */
  protected workEntryIdCounter = 0;

  // ---- 消息管理 ----

  /**
   * 开始新的用户轮次。
   *
   * @param content — 用户消息的内容块数组，通常为 `[{ type: "text", text: "..." }]`，
   *   也可包含图片块 `{ type: "image", data, mediaType }`
   * @returns 新轮次的 turnId（自增序号）
   */
  async beginUserTurn(content: MessageContent[]): Promise<number> {
    this.turnId++;
    this.messages.push({ role: "user", content, turnId: this.turnId });
    return this.turnId;
  }

  /**
   * 追加 assistant 消息到当前轮次。
   *
   * 在 LLM 返回完整响应后调用。
   *
   * @param content — assistant 消息的内容块数组，通常包含 text 和/或 tool_use 块
   */
  async addAssistantMessage(content: MessageContent[]): Promise<void> {
    this.messages.push({ role: "assistant", content, turnId: this.turnId });
  }

  /**
   * 追加工具执行结果到当前轮次。
   *
   * 工具结果以 `role: "user"` 的形式追加（符合 LLM API 的消息格式约定）。
   *
   * @param toolUseId — 对应的工具调用 ID（与 tool_use 块的 id 匹配）
   * @param content — 工具执行结果文本
   * @param isError — 是否为错误结果（影响 UI 展示样式）
   */
  async addToolResult(
    toolUseId: string,
    content: string,
    isError?: boolean,
  ): Promise<void> {
    this.messages.push({
      role: "user",
      content: [{ type: "tool_result" as const, toolUseId, content, isError }],
      turnId: this.turnId,
    });
  }

  /**
   * 通用消息追加方法。
   *
   * 用于注入系统级控制消息（nudge、steer 等）。
   *
   * @param role — 消息角色：`"user"` 或 `"assistant"`
   * @param content — 消息内容块数组
   */
  async addMessage(
    role: "user" | "assistant",
    content: MessageContent[],
  ): Promise<void> {
    this.messages.push({ role, content, turnId: this.turnId });
  }

  /**
   * 构建面向模型的上下文视图。
   *
   * 返回发送给 LLM provider 的消息列表的副本。
   * 未来会扩展支持选择性包含/排除执行计划、应用压缩摘要等。
   *
   * **turnContext 注入规则（缓存友好）：**
   * 临时上下文（日期/时区、编排状态等）作为本轮最后一条 user 消息的
   * 前导文本注入。这样 system prompt 前缀保持跨轮字节稳定，
   * 仅用户消息尾部变化，最大化 prompt cache 命中率。
   *
   * @param _opts.turnContext — 可选的临时上下文文本，注入到本轮最后一条 user 消息前
   * @param _opts.includeExecutionPlan — 是否将执行计划作为上下文包含
   * @returns 消息列表的副本（含注入的上下文）
   */
  getMessagesForModel(_opts?: { turnContext?: string; includeExecutionPlan?: boolean }): Message[] {
    const messages = [...this.messages];
    const turnContext = _opts?.turnContext?.trim();

    if (turnContext && messages.length > 0) {
      // 找到本轮第一条 user 消息（真正的用户输入，而非 tool_result），
      // 在其 content 前注入 turnContext。
      // 必须注入第一条而非最后一条，否则当最后一条 user 消息是
      // tool_result 时，注入的文本会破坏 assistant(tool_calls) → tool
      // 的连续消息格式，导致 API 报错。
      const currentTurnId = this.turnId;
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (msg.role === "user" && msg.turnId === currentTurnId) {
          // 跳过纯 tool_result 消息（content 全是 tool_result 块）
          const hasNonToolResult = msg.content.some((b) => b.type !== "tool_result");
          if (!hasNonToolResult) continue;

          messages[i] = {
            ...msg,
            content: [
              { type: "text" as const, text: turnContext },
              ...msg.content,
            ],
          };
          break;
        }
      }
    }

    return messages;
  }

  /**
   * 获取所有消息（内部使用）。
   *
   * @returns 消息列表的引用（非副本，注意可变性风险）
   */
  getAllMessages(): Message[] {
    return this.messages;
  }

  // ---- Token 估算 ----

  /**
   * 估算当前上下文的 token 数。
   *
   * **算法：** 将所有文本内容的总字符数除以 3.5。
   * 这是一个粗略估算（英文约 4 chars/token，中文约 1.5-2 chars/token，
   * 3.5 是一个折中均值），**不作为精确限制依据**，仅用于压缩触发判断。
   *
   * @returns 估算的 token 数（向上取整）
   */
  estimateModelTokens(): number {
    let chars = 0;
    for (const msg of this.messages) {
      for (const block of msg.content) {
        if ("text" in block) chars += (block as { text: string }).text.length;
        else if ("content" in block) chars += String((block as { content: string }).content).length;
      }
    }
    return Math.ceil(chars / 3.5);
  }

  // ---- 轮次管理 ----

  /**
   * 完成当前活跃轮次。
   *
   * 标记当前 turn 为已结束。在完整实现中会记录：
   * - 轮次完成状态
   * - 工具调用统计
   * - 用户反馈（如果有）
   *
   * @param _outcome — 可选的轮次结果标签（如 `"completed"`、`"aborted"`）
   */
  completeActiveTurn(_outcome?: string): void {
    // 在完整实现中会记录轮次完成状态
  }

  /**
   * 是否启用轮次追踪。
   *
   * 当前始终返回 `true`。未来可能支持无轮次追踪模式（轻量模式）。
   */
  hasTurnTracking(): boolean {
    return true;
  }

  /**
   * 获取 session 的唯一标识符。
   *
   * 当前未实现，返回 `undefined`。未来会用于：
   * - 多 session 管理
   * - provider 侧 session 复用（如 Anthropic 的 session_id）
   *
   * @returns session ID 或 undefined
   */
  getSessionId(): string | undefined {
    return undefined;
  }

  // ---- 执行计划 ----

  /**
   * 获取当前的执行计划。
   *
   * agent 通过 `TodoWrite` 等效工具创建/更新计划后，
   * Session 会自动解析并存储。runner 使用此方法来：
   * - 检查是否有未完成的步骤（提前完成拒绝）
   * - 在压缩时保留计划结构
   *
   * @returns 执行计划状态，或 undefined（agent 未创建计划）
   */
  getExecutionPlan(): ExecutionPlanState | undefined {
    return this.executionPlan;
  }

  /**
   * 确保执行计划已初始化（惰性创建）。
   *
   * 如果计划不存在，创建一个空的计划锚点（objective 为空，无步骤）。
   * runner 在每次工具循环前调用此方法，确保计划追踪结构存在。
   *
   * @returns 当前的或新创建的执行计划
   */
  ensureExecutionPlanAnchor(): ExecutionPlanState {
    if (!this.executionPlan) {
      this.executionPlan = {
        version: 1,
        objective: "",
        objectiveTurnId: this.turnId,
        updatedTurnId: this.turnId,
        steps: [],
      };
    }
    return this.executionPlan;
  }

  /**
   * 更新执行计划的步骤列表。
   *
   * 会完全替换现有步骤（非增量更新）。
   *
   * @param update.steps — 新的步骤列表，每项包含 step 描述文本和 status 状态。
   *   不传则不做任何修改（仅确保计划锚点存在）。
   * @returns 更新后的执行计划
   */
  updateExecutionPlan(
    update: { steps?: Array<{ step: string; status: ExecutionPlanStepStatus }> },
  ): ExecutionPlanState {
    const plan = this.ensureExecutionPlanAnchor();
    if (update.steps) {
      plan.steps = update.steps.map((s, i) => ({
        id: i + 1,
        step: s.step,
        status: s.status,
      }));
      plan.updatedTurnId = this.turnId;
    }
    return plan;
  }

  /**
   * 清除执行计划。
   *
   * 在 agent 完成所有步骤后调用，释放计划追踪资源。
   */
  clearExecutionPlan(): void {
    this.executionPlan = undefined;
  }

  // ---- 已完成工作账本 ----

  /**
   * 记录一条已完成的工作条目。
   *
   * 每个工具调用完成后，runner 会在 session 中记录一条 CompletedWork 条目。
   * 此账本用于：
   * - 压缩时保留"已做了什么"的关键信息
   * - 审计：回溯每个工具调用的输入输出
   * - 避免 agent 在压缩后重复已完成的工作
   *
   * @param input — 工作条目数据（无需 id 和 turnId，系统自动分配）
   * @returns 完整的 CompletedWorkEntry（含系统分配的 id 和 turnId）
   */
  recordCompletedWork(input: CompletedWorkInput): CompletedWorkEntry | undefined {
    const entry: CompletedWorkEntry = {
      ...input,
      id: ++this.workEntryIdCounter,
      turnId: this.turnId,
    };
    this.completedWork.push(entry);
    return entry;
  }

  /**
   * 获取已完成工作账本的只读副本。
   *
   * @returns 按时间顺序排列的已完成工作条目列表
   */
  getCompletedWorkLedger(): CompletedWorkEntry[] {
    return [...this.completedWork];
  }

  // ---- 历史资源 ----

  /**
   * 注册一个历史资源引用。
   *
   * HistoryResource 是经宿主侧验证的持久资源，跨轮次存在。
   * 例如用户上传的 PDF、agent 生成的文件等。
   *
   * @param _resource — 资源引用数据
   */
  addHistoryResource(_resource: HistoryResource & { sourceTurnId?: number }): void {
    // 在完整实现中会持久化资源引用
  }

  // ---- 压缩相关 ----

  /**
   * 获取待归档的历史轮次候选。
   *
   * runner 调用此方法检查是否有旧轮次可以被压缩为摘要。
   * 返回 null 表示当前无需压缩。
   *
   * @returns 压缩候选或 null
   */
  getPendingHistoryArchive(): HistoryArchiveCandidate | null {
    return null;
  }

  /**
   * 用 LLM 生成的摘要替换指定轮次的原始消息。
   *
   * 压缩后消息列表变短，释放上下文窗口空间。
   *
   * @param _summary — LLM 生成的摘要文本
   * @param _turnIds — 被替换的轮次 ID 列表
   */
  applyHistorySummary(_summary: string, _turnIds: readonly number[]): void {
    // 在完整实现中会用摘要替换旧轮次
  }

  /**
   * 获取待压缩的活跃检查点候选。
   *
   * 与历史归档不同，活跃检查点保留在上下文中但被压缩为结构化格式。
   *
   * @returns 压缩候选或 null
   */
  getPendingActiveCheckpoint(): ActiveCheckpointCandidate | null {
    return null;
  }

  /**
   * 应用活跃检查点压缩摘要。
   *
   * @param _summary — 结构化摘要
   * @param _epoch — 压缩周期编号
   */
  applyActiveCheckpointSummary(_summary: string, _epoch: number): void {
    // 在完整实现中会更新活动检查点
  }

  // ---- 工具测试辅助 ----

  /**
   * 估算保留在上下文尾部的 token 数。
   *
   * 用于计算压缩效果指标（压缩后 token 数 / 原始 token 数）。
   * 当前简化实现：仅统计最后 2 条消息。
   *
   * @returns 估算的尾部 token 数
   */
  estimateKeptTailTokens(): number {
    // 简化：返回最后 2 条消息的 token 估算
    const tail = this.messages.slice(-2);
    let chars = 0;
    for (const msg of tail) {
      for (const block of msg.content) {
        if ("text" in block) chars += (block as { text: string }).text.length;
        else if ("content" in block) chars += String((block as { content: string }).content).length;
      }
    }
    return Math.ceil(chars / 3.5);
  }
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 估算纯文本的 token 数。
 *
 * 使用粗略算法 `chars / 3.5`（折中英文 4 和中文 1.5-2 的均值）。
 * **不要用此函数做精确的 token 限制判断**，仅用于启发式决策（如压缩触发）。
 *
 * @param text — 待估算的文本
 * @returns 估算的 token 数（向上取整），空文本返回 0
 */
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

/**
 * 合并两个 token 用量统计。
 *
 * 将两次 LLM 调用的用量累加，用于计算整个 run 的总 token 消耗。
 * 所有字段（inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens）
 * 都是简单加法合并。
 *
 * @param a — 累计用量（或第一次用量）
 * @param b — 新增用量（或第二次用量）
 * @returns 合并后的用量对象
 */
export function mergeUsage(
  a: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; totalTokens: number },
  b: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; totalTokens: number },
): { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; totalTokens: number } {
  return {
    inputTokens: (a.inputTokens ?? 0) + (b.inputTokens ?? 0),
    outputTokens: (a.outputTokens ?? 0) + (b.outputTokens ?? 0),
    cacheReadTokens: (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0),
    cacheWriteTokens: (a.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0),
    totalTokens: (a.totalTokens ?? 0) + (b.totalTokens ?? 0),
  };
}
