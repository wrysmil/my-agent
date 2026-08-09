import type { ThinkingContent } from "../../shared/types.js";
import type { ApiProtocol, ReasoningConfig } from "../types.js";

export interface ThinkingAdapter {
  readonly api: ApiProtocol;
  extractFromRequest(reasoning: ReasoningConfig): unknown;
  extractFromResponse(message: unknown): ThinkingContent | null;
  reconcileForReplay(prev: ThinkingContent, targetApi: ApiProtocol): ThinkingContent | null;
}
