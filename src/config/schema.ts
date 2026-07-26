import { z } from "zod";

export const ProviderConfigSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  auth: z.enum(["api-key", "oauth", "token"]).optional(),
  maxConcurrency: z.number().int().positive().optional(),
});

export const ModelConfigSchema = z.object({
  provider: z.string(),
  model: z.string(),
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  supportsTools: z.boolean().optional(),
  supportsVision: z.boolean().optional(),
  supportsStreaming: z.boolean().optional(),
});

export const MemoryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  provider: z
    .enum(["openai", "gemini", "voyage", "mistral", "local", "auto"])
    .default("auto"),
  model: z.string().optional(),
  memoryDir: z.string().optional(),
  maxResults: z.number().int().positive().default(10),
  minScore: z.number().min(0).max(1).default(0.3),
  fts: z.object({ enabled: z.boolean().default(true) }).default({}),
  vector: z.object({ enabled: z.boolean().default(true) }).default({}),
  cache: z
    .object({
      enabled: z.boolean().default(true),
      maxEntries: z.number().int().positive().optional(),
    })
    .default({}),
});

export const AgentConfigSchema = z.object({
  defaultModel: z.string().default("claude-opus-4-8"),
  defaultProvider: z.string().default("anthropic"),
  // maxRetries 允许 0（关闭重试），maxToolLoops 至少 1（防止无限循环）
  maxRetries: z.number().int().min(0).default(3),
  maxToolLoops: z.number().int().positive().default(100),
  toolIdleTimeoutMs: z.number().int().positive().default(1_800_000),
  systemPrompt: z.string().optional(),
  thinkingLevel: z.enum(["off", "low", "high"]).default("off"),
});

export const MetacognitionConfigSchema = z.object({
  enabled: z.boolean().default(true),
  reflectThreshold: z.number().min(0).max(2).default(0.7),
  competenceCharLimit: z.number().int().positive().default(3000),
  strategiesCharLimit: z.number().int().positive().default(2500),
});

export const EvolutionConfigSchema = z.object({
  enabled: z.boolean().default(true),
  skillsDir: z.string().default("skills"),
  maxSkills: z.number().int().positive().default(200),
  maxSkillContentLength: z.number().int().positive().default(100_000),
  metacognition: MetacognitionConfigSchema.default({}),
});

export const CoreAgentConfigSchema = z.object({
  agent: AgentConfigSchema.default({}),
  models: z
    .object({
      providers: z.record(z.string(), ProviderConfigSchema).default({}),
      catalog: z.record(z.string(), ModelConfigSchema).default({}),
    })
    .default({}),
  memory: MemoryConfigSchema.default({}),
  evolution: EvolutionConfigSchema.default({}),
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type MetacognitionConfig = z.infer<typeof MetacognitionConfigSchema>;
export type EvolutionConfig = z.infer<typeof EvolutionConfigSchema>;
export type CoreAgentConfig = z.infer<typeof CoreAgentConfigSchema>;
