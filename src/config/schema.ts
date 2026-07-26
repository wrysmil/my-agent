import { z } from "zod";

// ============================================================================
// 配置 Schema 定义
// ============================================================================
// 本文件定义了 CoreAgent 框架的完整配置结构，使用 Zod 进行运行时校验。
// 每个 Schema 对象都设置了合理的默认值，外部传入的部分配置会自动与默认值合并。
// 配置从 JSON 文件加载，通过 CoreAgentConfigSchema.parse() 完成校验和补齐。

// ---------------------------------------------------------------------------
// ProviderConfig — LLM 提供商连接配置
// ---------------------------------------------------------------------------

/** LLM 提供商的连接与认证配置 */
export const ProviderConfigSchema = z.object({
  /** API 密钥，用于认证请求。不填则从环境变量推断。 */
  apiKey: z.string().optional(),
  /** API 基础 URL，适用于自定义端点或代理（如 OpenAI 兼容网关）。 */
  baseUrl: z.string().optional(),
  /** 认证方式：api-key（API 密钥）、oauth（OAuth 2.0）、token（Bearer Token）。 */
  auth: z.enum(["api-key", "oauth", "token"]).optional(),
  /** 该提供商的最大并发请求数。不填则使用框架内置默认值。 */
  maxConcurrency: z.number().int().positive().optional(),
});

// ---------------------------------------------------------------------------
// ModelConfig — 模型能力描述
// ---------------------------------------------------------------------------

/** 单个模型的能力与参数配置 */
export const ModelConfigSchema = z.object({
  /** 归属的提供商名称，对应 ProviderConfig 中的 key。 */
  provider: z.string(),
  /** 模型标识符（如 "claude-opus-4-8"、"gpt-4o"）。 */
  model: z.string(),
  /** 模型上下文窗口大小（token 数）。不填则使用模型默认值。 */
  contextWindow: z.number().int().positive().optional(),
  /** 单次请求最大输出 token 数。不填则使用模型默认值。 */
  maxOutputTokens: z.number().int().positive().optional(),
  /** 模型是否支持 tool-use / function calling。 */
  supportsTools: z.boolean().optional(),
  /** 模型是否支持视觉（图片输入）能力。 */
  supportsVision: z.boolean().optional(),
  /** 模型是否支持流式输出。 */
  supportsStreaming: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// MemoryConfig — 记忆系统配置
// ---------------------------------------------------------------------------

/** 长期记忆系统配置，控制记忆的存储、检索与缓存行为。 */
export const MemoryConfigSchema = z.object({
  /** 是否启用记忆系统。关闭后 Agent 不读取/写入记忆。 */
  enabled: z.boolean().default(true),
  /** 嵌入向量服务提供商。auto 表示自动选择（优先本地）。 */
  provider: z
    .enum(["openai", "gemini", "voyage", "mistral", "local", "auto"])
    .default("auto"),
  /** 嵌入模型名称。不填则由 provider 自动选择。 */
  model: z.string().optional(),
  /** 记忆文件存储目录。不填则使用默认路径。 */
  memoryDir: z.string().optional(),
  /** 检索时返回的最大记忆条数。 */
  maxResults: z.number().int().positive().default(10),
  /** 检索的最低相似度阈值（0-1），低于此分数的记忆将被过滤。 */
  minScore: z.number().min(0).max(1).default(0.3),
  /** 全文搜索（FTS）配置，基于关键字的记忆匹配。 */
  fts: z.object({ enabled: z.boolean().default(true) }).default({}),
  /** 向量搜索配置，基于语义相似度的记忆检索。 */
  vector: z.object({ enabled: z.boolean().default(true) }).default({}),
  /** 缓存配置，用于加速重复查询。 */
  cache: z
    .object({
      /** 是否启用查询缓存。 */
      enabled: z.boolean().default(true),
      /** 缓存最大条目数。不填则无上限。 */
      maxEntries: z.number().int().positive().optional(),
    })
    .default({}),
});

// ---------------------------------------------------------------------------
// AgentConfig — 核心 Agent 运行时行为
// ---------------------------------------------------------------------------

/** Agent 核心运行时参数配置 */
export const AgentConfigSchema = z.object({
  /** 默认使用的模型标识符。 */
  defaultModel: z.string().default("claude-opus-4-8"),
  /** 默认 LLM 提供商。 */
  defaultProvider: z.string().default("anthropic"),
  /**
   * LLM 调用失败时的最大重试次数。
   * - 设为 0 可完全关闭重试，让错误直接向上抛出
   * - 设为 3（默认）可在临时故障时自动恢复
   */
  maxRetries: z.number().int().min(0).default(3),
  /**
   * Agent 工具调用循环的最大迭代次数。
   * - 必须 >= 1，防止 Agent 陷入无限 tool-use 循环
   * - 100 次可以覆盖绝大多数多步骤任务
   */
  maxToolLoops: z.number().int().positive().default(100),
  /**
   * 工具调用空闲超时时间（毫秒）。
   * - 默认 30 分钟（1,800,000ms），适用于可能长时间运行的工具（如代码生成）
   * - 超时后 Agent 会终止当前任务
   */
  toolIdleTimeoutMs: z.number().int().positive().default(1_800_000),
  /** Agent 级别的系统提示词，会追加到内置 system prompt 之后。 */
  systemPrompt: z.string().optional(),
  /**
   * 扩展思考（extended thinking）级别。
   * - off: 关闭，仅常规推理
   * - low: 低强度思考，适用于简单任务
   * - high: 高强度思考，适用于复杂推理任务
   */
  thinkingLevel: z.enum(["off", "low", "high"]).default("off"),
});

// ---------------------------------------------------------------------------
// MetacognitionConfig — 元认知（自我反思）参数
// ---------------------------------------------------------------------------

/**
 * 元认知系统配置。
 * 元认知让 Agent 能够自我评估能力边界、识别需要求助的场景，
 * 并在关键决策点触发更深入的反思。
 */
export const MetacognitionConfigSchema = z.object({
  /** 是否启用元认知反思机制。 */
  enabled: z.boolean().default(true),
  /**
   * 反思触发阈值（0-2）。
   * - 0: 总是触发反思（最谨慎）
   * - 2: 几乎不触发反思（最激进）
   * - 默认 0.7 在谨慎与效率之间取得平衡
   */
  reflectThreshold: z.number().min(0).max(2).default(0.7),
  /** 能力描述文本的最大字符数限制，超出部分截断。 */
  competenceCharLimit: z.number().int().positive().default(3000),
  /** 策略描述文本的最大字符数限制，超出部分截断。 */
  strategiesCharLimit: z.number().int().positive().default(2500),
});

// ---------------------------------------------------------------------------
// EvolutionConfig — 技能进化系统配置
// ---------------------------------------------------------------------------

/**
 * 技能进化系统配置。
 * 进化系统允许 Agent 在运行过程中学习、积累和优化可复用的技能，
 * 类似于"从经验中学习"的机制。
 */
export const EvolutionConfigSchema = z.object({
  /** 是否启用技能进化功能。 */
  enabled: z.boolean().default(true),
  /** 技能定义文件的存储目录。 */
  skillsDir: z.string().default("skills"),
  /** 最大可存储的技能数量，防止无限膨胀。 */
  maxSkills: z.number().int().positive().default(200),
  /** 单个技能内容的最大字符数（默认 100K），防止超大技能文件。 */
  maxSkillContentLength: z.number().int().positive().default(100_000),
  /** 嵌套的元认知配置，控制进化过程中的自我评估行为。 */
  metacognition: MetacognitionConfigSchema.default({}),
});

// ---------------------------------------------------------------------------
// CoreAgentConfig — 顶级配置
// ---------------------------------------------------------------------------

/**
 * CoreAgent 框架的顶级配置。
 * 整合所有子系统的配置，作为唯一入口供外部加载和合并。
 *
 * @example
 * ```ts
 * // 加载默认配置（所有字段使用内置默认值）
 * const config = CoreAgentConfigSchema.parse({});
 *
 * // 覆盖部分字段
 * const config = CoreAgentConfigSchema.parse({
 *   agent: { maxRetries: 5 },
 *   memory: { provider: "local" },
 * });
 * ```
 */
export const CoreAgentConfigSchema = z.object({
  /** Agent 运行时行为配置。 */
  agent: AgentConfigSchema.default({}),
  /** 模型与提供商配置。 */
  models: z
    .object({
      /** 提供商注册表，key 为提供商名称，value 为其连接配置。 */
      providers: z.record(z.string(), ProviderConfigSchema).default({}),
      /** 模型目录，key 为模型名，value 为其能力描述。 */
      catalog: z.record(z.string(), ModelConfigSchema).default({}),
    })
    .default({}),
  /** 长期记忆系统配置。 */
  memory: MemoryConfigSchema.default({}),
  /** 技能进化系统配置。 */
  evolution: EvolutionConfigSchema.default({}),
});

// ============================================================================
// 类型导出
// ============================================================================
// 从 Zod Schema 推导 TypeScript 类型，确保编译期类型与运行时校验保持一致。

/** LLM 提供商的连接与认证配置（解析后类型）。 */
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
/** 单个模型的能力与参数配置（解析后类型）。 */
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
/** 长期记忆系统配置（解析后类型，含默认值）。 */
export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;
/** Agent 核心运行时参数配置（解析后类型，含默认值）。 */
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
/** 元认知系统配置（解析后类型，含默认值）。 */
export type MetacognitionConfig = z.infer<typeof MetacognitionConfigSchema>;
/** 技能进化系统配置（解析后类型，含默认值）。 */
export type EvolutionConfig = z.infer<typeof EvolutionConfigSchema>;
/** CoreAgent 框架顶级配置（解析后类型，含所有默认值）。 */
export type CoreAgentConfig = z.infer<typeof CoreAgentConfigSchema>;
