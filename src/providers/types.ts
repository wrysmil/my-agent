export type ModelCapabilities = {
  vision: boolean;
  tool_use: boolean;
  thinking: boolean;
  json_mode: boolean;
  prompt_caching: boolean;
  streaming: boolean;
};

export type ReasoningLevel = "off" | "low" | "medium" | "high";

export type ReasoningConfig = {
  level: ReasoningLevel;
  budgetTokens?: number;
};

export type ApiProtocol =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai"
  | "custom";

export type ModelDescriptor = {
  id: string;
  providerId: string;
  label: string;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: ModelCapabilities;
  api: ApiProtocol;
  pricing?: { inputPer1k: number; outputPer1k: number };
  reasoningLevels?: ReadonlyArray<ReasoningLevel>;
};
