import type { Usage, StopReason, MessageContent } from "../shared/types.js";

// ============================================================
// HistoryResource — 历史资源类型
// ============================================================

/**
 * 历史资源的来源分类。
 *
 * - `attachment`：用户上传的附件（文件、图片等），由宿主侧验证后注入
 * - `final_output`：上一轮 agent 的最终输出产物（如生成的文件）
 * - `explicit`：用户在 UI 中显式标记为"持久化"的资源（右键→固定到上下文）
 */
export type HistoryResourceKind = "attachment" | "final_output" | "explicit";

/**
 * 经宿主侧验证的持久资源引用。与消息附件不同，HistoryResource
 * 会跨轮次携带，不会随着上下文压缩而被丢弃。
 */
export type HistoryResource = {
  /** 资源来源分类，影响 UI 展示图标和压缩优先级 */
  kind: HistoryResourceKind;
  /** 资源在宿主文件系统中的路径 */
  path: string;
  /** 用户或 agent 给资源的备注说明 */
  note?: string;
  /** MIME 类型，如 `"image/png"`、`"application/pdf"` */
  mediaType?: string;
  /** 资源的显示名称（不传则用 path 的 basename） */
  name?: string;
  /**
   * 关联的会话轮次 ID。
   * - 不传：与当前轮次关联
   * - 传入历史 turnId：标记资源产自哪一轮
   */
  sourceTurnId?: number;
};

// ============================================================
// AgentRunParams — 启动一次 agent run 的参数
// ============================================================

/**
 * 启动一次 agent run 所需的全部参数。
 *
 * 一次 "run" = 一个完整的"用户发消息 → LLM 回复（可能含工具调用）→ 返回结果"闭环。
 * 调用方（通常是 UI 层或编排层）构造此对象传给 `AgentRunner.run()` / `runStream()`。
 */
export type AgentRunParams = {
  // ---- 必填 ----

  /**
   * 发送给 agent 的用户消息正文。
   *
   * 这是本轮对话的**核心输入**。可以是自然语言指令、问题、或任何要 agent 处理的内容。
   * 该消息会作为 `role: "user"` 进入会话历史。
   *
   * @example "帮我重构 src/utils/ 下的所有 TypeScript 文件"
   * @example "这段代码有什么性能问题？"
   */
  message: string;

  // ---- 多媒体附件 ----

  /**
   * 可选的图像附件，以 base64 编码字符串形式传入。
   *
   * 支持的媒体类型：
   * - `"image/png"` — PNG 格式，推荐用于截图、图表
   * - `"image/jpeg"` — JPEG 格式，推荐用于照片
   * - `"image/gif"` — GIF 格式，支持动图
   * - `"image/webp"` — WebP 格式，压缩率更高
   *
   * **注意：**
   * - 每张图片会占用大量上下文 token，建议单轮不超过 5 张
   * - base64 数据**不包含** `data:image/...;base64,` 前缀，仅纯数据
   * - 大图应预先压缩到 1024px 以内
   *
   * @example
   * ```ts
   * images: [{
   *   data: "/9j/4AAQSkZJRg...",
   *   mediaType: "image/png"
   * }]
   * ```
   */
  images?: Array<{
    /** base64 编码的图片数据（不含 data URI 前缀） */
    data: string;
    /** 图片 MIME 类型 */
    mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  }>;

  // ---- 持久资源 ----

  /**
   * 本 UI 轮次中经宿主侧验证的持久资源列表（附件/历史产物）。
   *
   * 与单次消息附件不同，historyResources 会：
   * 1. 在上下文压缩时优先保留
   * 2. 跨轮次追踪（通过 sourceTurnId）
   * 3. 在 UI 中显示为独立的资源面板
   *
   * **典型场景：**
   * - 用户上传了 PDF，agent 需要跨多轮引用
   * - 上一轮生成了 `output.csv`，本轮要继续分析
   */
  historyResources?: HistoryResource[];

  // ---- 宿主元数据 ----

  /**
   * 供 provider 适配器使用的宿主私有元数据。
   *
   * 不会进入会话历史，不会发送给模型。仅用于 provider 内部路由/日志/追踪。
   * 例如：UI 会话 ID、租户 ID、请求来源标识等。
   *
   * @example
   * ```ts
   * requestMetadata: {
   *   tenantId: "tenant-123",
   *   source: "vscode-extension",
   *   traceId: "abc-def-123"
   * }
   * ```
   */
  requestMetadata?: Record<string, unknown>;

  // ---- 临时上下文 ----

  /**
   * 每轮临时上下文（如编排账本、日期时间、当前环境信息）。
   *
   * **关键特性：不持久化到 session。** 仅注入到本轮用户消息视图中，
   * 下一轮不会自动携带。适合注入"当前时间"、"当前分支名"等瞬态信息。
   *
   * 注入位置：作为本轮 user 消息的前导文本，对模型可见但对用户不可见。
   *
   * @example
   * ```ts
   * turnEphemeral: "当前时间: 2026-08-02T15:30:00+08:00\n当前分支: feature/my-work"
   * ```
   */
  turnEphemeral?: string;

  // ---- 模型 & Provider 覆盖 ----

  /**
   * 本次 run 的模型覆盖。
   *
   * 覆盖 `CoreAgentConfig.agent.defaultModel` 的默认值。
   * 格式取决于 provider 实现，常见格式：
   * - `"claude-sonnet-5"` — Anthropic 模型 ID
   * - `"gpt-4o"` — OpenAI 模型 ID
   * - `"deepseek-v4-pro"` — DeepSeek 模型 ID
   *
   * **不传：** 使用配置中的 defaultModel。
   * **传入：** 仅本次 run 生效，不会改变全局配置。
   *
   * **约束：** 目标模型必须存在于 `CoreAgentConfig.models.catalog` 中，
   * 否则 run 会以 `provider_error` 失败。
   */
  model?: string;

  /**
   * 本次 run 的 provider 覆盖。
   *
   * 覆盖 `CoreAgentConfig.agent.defaultProvider` 的默认值。
   * provider 是 LLM 服务提供商标识，如：
   * - `"anthropic"` — Anthropic API
   * - `"openai"` — OpenAI API
   * - `"deepseek"` — DeepSeek API
   *
   * **不传：** 使用配置中的 defaultProvider。
   * **传入：** 仅本次 run 生效，常用于 A/B 测试或 fallback 场景。
   *
   * **注意：** provider+model 组合必须已在 `ProviderRegistry` 中注册，
   * 否则 run 会返回 `auth` 错误。
   */
  provider?: string;

  // ---- System Prompt ----

  /**
   * System prompt 覆盖。
   *
   * 完全替换默认的 system prompt（而非追加）。
   *
   * **默认值（按优先级）：**
   * 1. `params.systemPrompt`（此字段）— 最高优先级
   * 2. `CoreAgentConfig.agent.systemPrompt` — 配置中的自定义 prompt
   * 3. 内置 fallback：`"You are a helpful AI assistant with access to tools..."`
   *
   * **典型用法：**
   * - 为特定任务注入角色指令："你是一个资深 Rust 代码审查员..."
   * - 限制 agent 行为："只读模式，禁止修改任何文件"
   */
  systemPrompt?: string;

  // ---- 生命周期控制 ----

  /**
   * 中止信号。用于从外部取消正在进行的 run。
   *
   * 传入一个 `AbortController` 的 signal：
   * ```ts
   * const ac = new AbortController();
   * const promise = runner.run({ message: "...", signal: ac.signal });
   * // 用户点击取消
   * ac.abort();
   * ```
   *
   * **中止时的行为：**
   * - 正在执行的工具调用会被中断
   * - `AgentRunMeta.aborted` 被设为 `true`
   * - `stopReason` 仍为模型原始返回值，但会在 event 中体现中断
   *
   * **注意：** 已发送给 provider 的请求无法中止（HTTP 层面），
   * 但响应会被丢弃。
   */
  signal?: AbortSignal;

  // ---- 工具执行环境 ----

  /**
   * 工具执行的工作目录。
   *
   * 所有工具（Bash、Read、Write 等）的相对路径都基于此目录解析。
   *
   * **不传：** 默认使用当前进程的工作目录（`process.cwd()`）。
   * **传入：** 工具将在指定目录下执行，适合 sandbox 或多项目切换场景。
   *
   * @example "/home/user/projects/my-app"
   */
  workingDir?: string;

  // ---- Thinking/Reasoning 控制 ----

  /**
   * Thinking/reasoning 级别控制。
   *
   * 控制模型在生成回复前进行"内部思考"的程度。仅对支持 extended thinking 的模型生效
   * （如 Claude Opus 5、Sonnet 5 等）。
   *
   * 可选值：
   * - `"off"` — 禁用 thinking，直接生成回复。
   *   适用于：简单问答、格式转换、已知答案的确认
   * - `"low"` — 轻度思考（通常 < 1024 tokens）。
   *   适用于：代码补全、简单重构、翻译
   * - `"high"` — 深度思考（可能上万 tokens）。
   *   适用于：复杂架构设计、多步骤推理、数学证明、安全审计
   *
   * **不传：** 使用 provider 默认值（通常为 `"off"` 或 `"low"`）。
   *
   * **性能影响：**
   * - thinking tokens 会计入 output token 用量（需付费）
   * - `"high"` 模式首 token 延迟明显增加（可能数秒到数十秒）
   * - 对不支持 thinking 的模型，此参数被静默忽略
   */
  thinkingLevel?: "off" | "low" | "medium" | "high";

  // ---- Sandbox 环境 ----

  /**
   * 注入到 sandbox 子进程的环境变量。
   *
   * 这些变量会合并到工具执行时的子进程环境中。
   * key 是环境变量名，value 是变量值。
   *
   * **不会影响：** 当前 Node.js 进程的环境变量。
   * **仅影响：** 通过 `ToolContext` 执行的工具（如 Bash 命令、脚本运行）。
   *
   * **安全注意：** 不要在 sandbox 变量中放入密钥/Token。
   * 工具输出可能被发送给 LLM 或记录到日志。
   *
   * @example
   * ```ts
   * sandboxEnv: {
   *   NODE_ENV: "test",
   *   DEBUG: "myapp:*",
   *   PROJECT_ROOT: "/tmp/sandbox/project"
   * }
   * ```
   */
  sandboxEnv?: Record<string, string>;

  // ---- Prompt Cache ----

  /**
   * prompt-cache TTL 策略。
   *
   * 控制发送给 LLM provider 的 prompt cache 写入/保留策略。
   * 仅对支持 prompt caching 的 provider 生效（如 Anthropic）。
   *
   * 可选值：
   * - `"none"` — 不写入 cache。
   *   适用于：一次性请求、高度动态的上下文
   * - `"short"` — 短 TTL（通常 5 分钟）。
   *   适用于：连续对话中的快速跟进问题、多轮迭代
   * - `"long"` — 长 TTL（通常 30 分钟+）。
   *   适用于：跨越多个独立请求的长期会话、固定的 system prompt
   *
   * **成本权衡：**
   * - cache write 有额外成本（比普通输入贵）
   * - cache read 有折扣（比普通输入便宜）
   * - 如果同一上下文会被重复使用 ≥3 次，cache 通常是划算的
   *
   * **不传：** 使用 provider 默认策略。
   */
  cacheRetention?: "none" | "short" | "long";

  // ---- Interrupt-Steer ----

  /**
   * interrupt-steer 钩子：在每次工具循环边界由 runner 调用。
   *
   * runner 在以下时机调用此函数：
   * 1. 每次工具循环迭代开始前
   * 2. 模型输出文本（无工具调用）准备返回前
   *
   * **返回值：** 宿主希望作为用户消息注入到上下文中的文本数组。
   * 每条文本作为独立的 user 消息追加。返回空数组或 `undefined` 表示无需干预。
   *
   * **典型用途：**
   * - UI 层在此期间收到用户的新消息 → 注入到当前 run 中
   * - 外部系统检测到状态变更 → 通知 agent 更新上下文
   * - 超时/预算控制 → 注入"你还有 30 秒完成"等提醒
   *
   * **注意：**
   * - 函数应为同步（或微任务），不要有长时间阻塞操作
   * - 抛出的异常会被静默吞掉（设计上不因 steer 失败中断 run）
   * - 过于频繁的 steer 会导致 token 快速膨胀
   *
   * @example
   * ```ts
   * drainSteer: () => {
   *   if (userSentNewMessage) return ["用户说：请改用 Python 实现"];
   *   return undefined;
   * }
   * ```
   */
  drainSteer?: () => string[] | undefined;
};

// ============================================================
// AgentRunResult — 单次 agent run 的结果
// ============================================================

/**
 * 单次 agent run 的完整结果。
 *
 * 包含 agent 的最终文本响应、全部内容块、以及运行元数据。
 * 通过 `AgentRunner.run()` 返回的 Promise 或 `runStream()` 的 `done` 事件获取。
 */
export type AgentRunResult = {
  /**
   * agent 的最终文本响应。
   *
   * 这是从所有 content 块中提取的纯文本拼接。
   * 如果 run 以错误结束，此字段为空字符串。
   * 如果 run 以工具调用结束（上限达到），此字段为工具循环摘要。
   */
  text: string;

  /**
   * 最终响应中的全部内容块。
   *
   * 内容块类型包括：
   * - `{ type: "text", text: "..." }` — 文本片段
   * - `{ type: "tool_use", id: "...", name: "...", input: {...} }` — 工具调用
   *
   * **注意：** 此字段包含的是**最后一轮**的 assistant 消息内容，
   * 中间的文本增量和工具调用通过 `AgentRunEvent` 流式传出，
   * 不在此字段中重复。
   */
  content: MessageContent[];

  /** Run 元数据，包含计时、用量、模型信息等。 */
  meta: AgentRunMeta;
};

// ============================================================
// AgentRunTimings — 非重叠墙钟时间桶
// ============================================================

/**
 * Agent run 的非重叠墙钟时间桶。
 *
 * 将 run 的总时长分解为互斥的时间类别，用于性能分析和 UI 展示。
 * 四个时间桶之和 + `otherMs` ≈ `AgentRunMeta.durationMs`。
 *
 * **关键保证：** 各桶之间不重叠（互斥），总和接近 wall-clock 总时长。
 */
export type AgentRunTimings = {
  /**
   * 等待 LLM provider 响应的时间（含网络延迟）。
   *
   * 包括：首 token 延迟 + 后续 token 生成时间。
   * 不包括：provider 内部的重试等待（计入 retryWaitMs）。
   *
   * **优化方向：** 使用更快的模型、减少输出 token 数、启用 streaming。
   */
  providerMs: number;

  /**
   * 工具执行的总墙钟时间。
   *
   * 包括：工具进程启动、执行、收集输出。
   * 并行工具执行时，此时间为并行批次的 wall-clock 时间之和（而非最长者）。
   *
   * **优化方向：** 缓存常用工具结果、优化工具实现、增加并行度。
   */
  toolMs: number;

  /**
   * 上下文压缩（compaction）所花的时间。
   *
   * 包括：生成摘要的 LLM 调用时间 + 序列化/替换时间。
   * 仅在 compaction 实际触发时 > 0。
   */
  compactionMs: number;

  /**
   * 重试退避休眠时间。
   *
   * runner 在遇到可重试错误（rate_limit、临时网络错误）后的
   * 显式退避等待时间。provider 内部的自动重试不计入此字段。
   *
   * 算法：指数退避 + jitter，`2^attempt * 1000ms`，上限 30s。
   */
  retryWaitMs: number;

  /**
   * 剩余编排、序列化、渲染事件与簿记时间。
   *
   * = 总 wall-clock 时间 − (providerMs + toolMs + compactionMs + retryWaitMs)。
   * 包括：消息构造、事件序列化、session 维护、日志写盘等。
   *
   * 正常情况下此值很小（毫秒级），如果很大说明存在可优化的簿记瓶颈。
   */
  otherMs: number;
};

// ============================================================
// AgentRunMeta — 关于一次 agent run 的元数据
// ============================================================

/**
 * 关于一次 agent run 的完整元数据。
 *
 * 包含 run 的计时、用量、模型信息、工具调用统计等。
 * 用于 UI 展示（如 token 消耗面板）、日志记录和性能分析。
 */
export type AgentRunMeta = {
  /**
   * run 的总持续时长（毫秒）。
   *
   * 从 `run()` / `runStream()` 调用开始到 `done` 事件发出的 wall-clock 时间。
   *
   * 典型值参考：
   * - 简单问答（无工具）：500ms–3s
   * - 有工具调用（1-3 轮）：3s–30s
   * - 复杂多步骤任务（5+ 轮）：30s–5min
   */
  durationMs: number;

  /** 本次 run 实际使用的模型 ID（如 `"claude-sonnet-5"`）。 */
  model: string;

  /** 本次 run 实际使用的 provider ID（如 `"anthropic"`）。 */
  provider: string;

  /**
   * 模型停止原因。
   *
   * 常见值（取决于 provider）：
   * - `"end_turn"` — 模型自然结束回复
   * - `"max_tokens"` — 达到 maxOutputTokens 上限 → 自动重试
   * - `"stop_sequence"` — 命中自定义停止序列
   * - `"tool_use"` — 模型决定调用工具
   */
  stopReason: StopReason;

  /** 累计 token 用量（input + output + cache）。 */
  usage: Usage;

  /**
   * tool-use 循环迭代次数。
   *
   * = 模型被调用且返回工具调用的次数。
   * 如果模型直接回复文本（无工具调用），此值为 0。
   *
   * 死循环阈值：≥ LOOP_WARN(3) 触发警告 nudge，≥ LOOP_HARD(5) 强制终止。
   */
  toolLoops: number;

  /**
   * 上下文压缩（compaction）周期次数。
   *
   * 每次压缩将旧的对话历史替换为摘要，释放上下文窗口。
   * 此值为 0 表示本次 run 未触发压缩。
   */
  compactionCount: number;

  /** 非重叠墙钟时间桶，用于性能诊断。 */
  timings?: AgentRunTimings;

  /** run 是否被 `AbortSignal` 中止。 */
  aborted?: boolean;

  /**
   * run 失败时的错误信息。
   *
   * 仅在 run 以错误结束时存在。
   * error.kind 分类：
   * - `"auth"` — 认证/鉴权失败（API key 无效、权限不足）
   * - `"rate_limit"` — 速率限制（请求过于频繁）
   * - `"context_overflow"` — 上下文窗口溢出（消息太多太长）
   * - `"timeout"` — 超时（provider 响应超时或工具执行超时）
   * - `"provider_error"` — 其他 provider 内部错误
   */
  error?: {
    /** 错误类别 */
    kind: "auth" | "rate_limit" | "context_overflow" | "timeout" | "provider_error";
    /** 人类可读的错误描述 */
    message: string;
  };

  /**
   * 本次 run 中实际被调用的工具名称（去重）。
   *
   * 可用于：
   * - UI 展示"本次使用了哪些工具"
   * - 统计工具使用频率
   * - 审计：检测是否调用了预期外的工具
   *
   * @example ["Bash", "Read", "Write", "Grep"]
   */
  toolNames?: string[];

  /**
   * 本次 run 中经 skill_manage 工具加载的 skill id。
   *
   * 仅在 provider 支持 skill 动态加载（如 Anthropic Claude Code）时有值。
   *
   * @example ["frontend-design", "systematic-debugging"]
   */
  skillsLoaded?: string[];

  /**
   * 因瞬时（可恢复）错误失败的工具调用次数。
   *
   * 瞬时错误：网络超时、临时文件锁、进程信号中断等。
   * 此类错误通常可通过重试恢复，但本次 run 可能因为重试次数耗尽而放弃。
   */
  transientToolErrors?: number;

  /**
   * 因永久（不可恢复）错误失败的工具调用次数。
   *
   * 永久错误：文件不存在、权限拒绝、语法错误、命令不存在等。
   * 此类错误重试无意义，需人工干预。
   */
  permanentToolErrors?: number;
};

// ============================================================
// AgentRunEvent — agent run 期间流式发出的事件
// ============================================================

/**
 * Agent run 期间流式发出的事件联合类型。
 *
 * 通过 `runStream()` 的 AsyncIterable 获取。每种事件类型对应 run 生命周期
 * 中的一个阶段或状态变更。调用方按 `type` 字段区分并处理。
 *
 * **事件流示例（典型的一次工具调用 run）：**
 * ```
 * text_delta → text_delta → tool_delta → tool_start →
 * tool_progress → tool_progress → tool_end →
 * text_delta → text_delta → done
 * ```
 */
export type AgentRunEvent =
  // ---- 文本流 ----
  | {
      /**
       * 模型输出的文本增量。
       *
       * 每次发出一个文本片段（通常几个 token），
       * 调用方应拼接所有 text_delta 得到完整回复。
       *
       * **触发时机：** 模型生成过程中，有新的文本 token 可用时。
       * **频率：** 高（每秒数十到数百次，取决于模型速度）。
       */
      type: "text_delta";
      /** 本次增量的文本内容 */
      text: string;
    }

  // ---- 工具调用流（delta 模式） ----
  | {
      /**
       * 工具调用参数的增量更新。
       *
       * 模型生成工具调用的 JSON 参数时，逐片发出。
       * 调用方应累积 inputDelta 直到 tool_end 得到完整参数。
       *
       * **首次出现：** name 有值（告知工具名），inputDelta 可能为空。
       * **后续出现：** name 为 undefined，仅追加 inputDelta。
       *
       * **触发时机：** 模型开始生成工具调用参数时。
       */
      type: "tool_delta";
      /** 工具名称（仅在首次 delta 时有值） */
      name?: string;
      /** 工具调用唯一标识 */
      id: string;
      /** JSON 参数的增量文本 */
      inputDelta: string;
      /** 已传输的输入字节数（可选，用于进度条） */
      inputBytes?: number;
    }

  // ---- 工具执行边界 ----
  | {
      /**
       * 工具开始执行。
       *
       * 此时模型的工具调用参数已完整接收，runner 即将或已开始执行工具。
       *
       * **触发时机：** runner 将工具调用入队准备执行时。
       */
      type: "tool_start";
      /** 工具名称 */
      name: string;
      /** 工具调用唯一标识（用于关联 tool_delta 和 tool_end） */
      id: string;
      /** 完整的工具输入参数（已解析为 JS 对象） */
      input: unknown;
    }
  | {
      /**
       * 工具执行过程中的进度更新。
       *
       * 长时运行的工具（如大文件下载、批量处理）可选择性发出进度事件。
       * 不是所有工具都支持此事件。
       *
       * **触发时机：** 工具通过 `ToolContext.emitProgress()` 主动报告时。
       */
      type: "tool_progress";
      /** 工具名称 */
      name: string;
      /** 工具调用唯一标识 */
      id: string;
      /** 进度阶段标识（如 `"download"`、`"process"`） */
      phase?: string;
      /** 人类可读的进度描述（如 `"已处理 150 / 500 条记录"`） */
      message: string;
      /** 结构化的进度数据（如 `{ current: 150, total: 500 }`） */
      data?: Record<string, unknown>;
    }
  | {
      /**
       * 工具执行完成。
       *
       * 包含执行结果或错误信息。这是工具的终态事件。
       *
       * **触发时机：** 工具执行完毕（成功或失败）时。
       */
      type: "tool_end";
      /** 工具名称 */
      name: string;
      /** 工具调用唯一标识 */
      id: string;
      /** 工具执行结果文本（成功时的输出，或失败时的错误描述） */
      result: string;
      /**
       * 持久化输出引用（如果工具将结果写入了文件）。
       *
       * 例如 Write 工具会将写入的文件注册为持久化输出，
       * 后续工具可以引用此文件。
       */
      persistedOutput?: { path: string; size: number; ref: string };
      /** 结果是否为错误 */
      isError?: boolean;
      /** 错误码（如 `"ENOENT"`、`"EACCES"`、`"TIMEOUT"`） */
      errorCode?: string;
      /**
       * 错误严重程度：
       * - `"recoverable"` — 可恢复（超时、网络抖动），可重试
       * - `"error"` — 不可恢复（权限拒绝、文件不存在），不应重试
       */
      errorSeverity?: "recoverable" | "error";
      /** 工具执行耗时（毫秒） */
      durationMs?: number;
    }

  // ---- 上下文压缩 ----
  | {
      /**
       * 上下文压缩完成。
       *
       * runner 检测到上下文窗口接近上限（≥ 82%），
       * 自动将历史对话压缩为摘要后发出此事件。
       *
       * **触发时机：** compaction 完成后。
       */
      type: "compaction";
      /** 压缩前的 token 估算数 */
      tokensBefore: number;
      /** 压缩后的 token 估算数 */
      tokensAfter: number;
      /** 压缩生成的摘要文本（可选） */
      summary?: string;
      /** 压缩过程中 LLM 调用的 token 消耗 */
      usage?: Usage;
      /** 压缩耗时（毫秒） */
      durationMs?: number;
    }

  // ---- 上下文状态 ----
  | {
      /**
       * 上下文管理状态变更。
       *
       * 覆盖上下文压缩的完整生命周期，包括历史摘要和活跃处理上下文
       * 两种压缩模式。
       *
       * **触发时机：** 压缩过程的各个阶段。
       */
      type: "context_status";
      /**
       * 上下文处理阶段：
       *
       * 历史摘要模式（history_summary）— 将旧轮次压缩为摘要：
       * - `"history_summary_start"` — 开始生成历史摘要
       * - `"history_summary_done"` — 历史摘要生成成功
       * - `"history_summary_failed"` — 历史摘要生成失败（继续使用原文）
       *
       * 活跃处理压缩（active_process_compaction）— 压缩工具执行上下文：
       * - `"active_process_compaction_start"` — 开始压缩活跃处理上下文
       * - `"active_process_compaction_done"` — 活跃处理压缩成功
       * - `"active_process_compaction_failed"` — 活跃处理压缩失败
       */
      phase:
        | "history_summary_start"
        | "history_summary_done"
        | "history_summary_failed"
        | "active_process_compaction_start"
        | "active_process_compaction_done"
        | "active_process_compaction_failed";
      /** 人类可读的状态描述 */
      message: string;
      /** 附加数据（如 discardedTurns: [1,2,3]） */
      data?: Record<string, unknown>;
    }

  // ---- 重试 ----
  | {
      /**
       * 即将进行重试。
       *
       * 模型调用遇到可重试错误（rate_limit、临时网络错误）时发出。
       * 事件发出后 runner 会等待 waitMs 毫秒再重试。
       *
       * **触发时机：** 重试开始前。
       */
      type: "retry";
      /** 第几次重试（从 1 开始） */
      attempt: number;
      /** 重试原因描述 */
      reason: string;
      /** 重试前的等待时间（毫秒），0 表示立即重试 */
      waitMs?: number;
    }

  // ---- Provider Fallback ----
  | {
      /**
       * Provider 回退通知。
       *
       * 当首选 provider 认证失败时，runner 自动切换到备用 provider。
       *
       * **触发时机：** provider 认证失败，有备用 provider 可用时。
       */
      type: "provider_fallback";
      /** 回退原因（目前仅 `"auth"`） */
      reason: "auth";
      /** 切换到的备用 provider ID */
      providerId: string;
    }

  // ---- 终止 ----
  | {
      /**
       * Run 完成。
       *
       * 流事件的终止标记，包含完整的 AgentRunResult。
       * 此事件之后不会再有其他事件。
       *
       * **触发时机：** 所有处理完成后，必定发出（无论成功或失败）。
       */
      type: "done";
      /** 完整的 run 结果 */
      result: AgentRunResult;
    };
