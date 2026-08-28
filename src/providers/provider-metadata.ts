/**
 * 多厂商 Provider 类型常量与元数据。
 *
 * 一处定义、全局使用 — providers-store / validators / loader / bin / chat / 前端
 * 所有引用此模块获取支持的 provider 类型列表。
 */

export const PROVIDER_TYPES = [
  "deepseek",
  "anthropic",
  "openai",
  "google",
  "moonshot",
  "qwen",
  "mistral",
  "xai",
  "minimax",
] as const;

export type ProviderType = (typeof PROVIDER_TYPES)[number];

export interface ProviderMeta {
  label: string;
  defaultBaseUrl: string;
  envKey: string;
  defaultModel: string;
}

export const PROVIDER_META: Record<ProviderType, ProviderMeta> = {
  deepseek: {
    label: "DeepSeek",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    envKey: "DEEPSEEK_API_KEY",
    defaultModel: "deepseek-chat",
  },
  anthropic: {
    label: "Anthropic",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    envKey: "ANTHROPIC_API_KEY",
    defaultModel: "claude-sonnet-4-5",
  },
  openai: {
    label: "OpenAI",
    defaultBaseUrl: "https://api.openai.com/v1",
    envKey: "OPENAI_API_KEY",
    defaultModel: "gpt-4o",
  },
  google: {
    label: "Google Gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    envKey: "GOOGLE_API_KEY",
    defaultModel: "gemini-2.5-flash",
  },
  moonshot: {
    label: "Moonshot (月之暗面)",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    envKey: "MOONSHOT_API_KEY",
    defaultModel: "moonshot-v1-8k",
  },
  qwen: {
    label: "Qwen (通义千问)",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    envKey: "QWEN_API_KEY",
    defaultModel: "qwen-max",
  },
  mistral: {
    label: "Mistral AI",
    defaultBaseUrl: "https://api.mistral.ai/v1",
    envKey: "MISTRAL_API_KEY",
    defaultModel: "mistral-large-latest",
  },
  xai: {
    label: "Grok (xAI)",
    defaultBaseUrl: "https://api.x.ai/v1",
    envKey: "XAI_API_KEY",
    defaultModel: "grok-2",
  },
  minimax: {
    label: "MiniMax",
    defaultBaseUrl: "https://api.minimax.chat/v1",
    envKey: "MINIMAX_API_KEY",
    defaultModel: "MiniMax-Text-01",
  },
};
