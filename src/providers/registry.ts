import type { CoreAgentConfig } from "../config/schema.js";
import type { LLMProvider, ProviderFactory } from "./base.js";

/**
 * Provider 注册表：管理 LLM provider 实例的创建、缓存和模型解析。
 *
 * 核心职责：
 * - 按 ID 创建/获取 provider 实例（惰性创建 + 缓存）
 * - 解析 "provider/model" 格式的模型字符串
 * - 支持工厂注册，允许扩展自定义 provider
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, LLMProvider>();
  private readonly factories = new Map<string, ProviderFactory>();

  constructor(config?: CoreAgentConfig) {
    // 从配置创建 provider（如果有 providers 配置块）
    if (config?.models?.providers) {
      for (const [id, providerConfig] of Object.entries(config.models.providers)) {
        this.createProvider(id, providerConfig);
      }
    }
  }

  /** 注册自定义 provider 工厂。 */
  registerFactory(id: string, factory: ProviderFactory): void {
    this.factories.set(id, factory);
  }

  /** 按 ID 获取或创建 provider（同步，惰性）。 */
  get(id: string): LLMProvider | undefined {
    if (this.providers.has(id)) {
      return this.providers.get(id);
    }

    const factory = this.factories.get(id);
    if (factory) {
      const provider = factory({});
      this.providers.set(id, provider);
      return provider;
    }

    return undefined;
  }

  /**
   * 为给定模型字符串解析 provider。
   *
   * 支持两种格式：
   * - "anthropic/claude-sonnet-5" → provider="anthropic", modelId="claude-sonnet-5"
   * - "claude-sonnet-5" → 按前缀匹配（claude→anthropic, gpt→openai, gemini→google）
   *
   * 如果都不匹配，回退到第一个已注册的 provider。
   */
  resolveForModel(model: string): { provider: LLMProvider; modelId: string } | undefined {
    // 若模型名含斜杠，前缀即为 provider
    const slashIdx = model.indexOf("/");
    if (slashIdx > 0) {
      const providerId = model.slice(0, slashIdx);
      const modelId = model.slice(slashIdx + 1);
      const provider = this.get(providerId);
      if (provider) return { provider, modelId };
    }

    // 按模型名前缀猜测 provider
    if (model.startsWith("claude-") || model.startsWith("claude")) {
      const provider = this.get("anthropic");
      if (provider) return { provider, modelId: model };
    }
    if (model.startsWith("gpt-") || model.startsWith("o1") || model.startsWith("o3") || model.startsWith("o4")) {
      const provider = this.get("openai");
      if (provider) return { provider, modelId: model };
    }
    if (model.startsWith("gemini-")) {
      const provider = this.get("google");
      if (provider) return { provider, modelId: model };
    }
    if (model.startsWith("deepseek-")) {
      const provider = this.get("deepseek");
      if (provider) return { provider, modelId: model };
    }
    if (model.startsWith("moonshot-")) {
      const provider = this.get("moonshot");
      if (provider) return { provider, modelId: model };
    }
    if (model.startsWith("qwen-")) {
      const provider = this.get("qwen");
      if (provider) return { provider, modelId: model };
    }
    if (model.startsWith("mistral-") || model.startsWith("codestral")) {
      const provider = this.get("mistral");
      if (provider) return { provider, modelId: model };
    }
    if (model.startsWith("grok-")) {
      const provider = this.get("xai");
      if (provider) return { provider, modelId: model };
    }

    // 回退：尝试每个已注册的 provider
    for (const [, provider] of this.providers) {
      return { provider, modelId: model };
    }

    return undefined;
  }

  /** 列出所有可用 provider ID。 */
  list(): string[] {
    return [...new Set([...this.providers.keys(), ...this.factories.keys()])];
  }

  /** 直接注入一个已创建的 provider 实例（用于从外部 store 同步）。 */
  setProvider(id: string, provider: LLMProvider): void {
    this.providers.set(id, provider);
  }

  private createProvider(
    id: string,
    config: { apiKey?: string; baseUrl?: string },
  ): LLMProvider | undefined {
    const factory = this.factories.get(id);
    if (factory) {
      const provider = factory(config);
      this.providers.set(id, provider);
      return provider;
    }
    return undefined;
  }
}
