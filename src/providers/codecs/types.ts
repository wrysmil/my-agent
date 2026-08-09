import type { MessageContent, StopReason } from "../../shared/types.js";
import type { ApiProtocol } from "../types.js";
import type { ToolDefinition } from "../base.js";

export type IncomingBlock = unknown;
export type OutgoingBlock = unknown;

export interface ContentBlockCodec {
  readonly api: ApiProtocol;
  inbound(message: IncomingBlock): MessageContent[];
  outbound(block: MessageContent): OutgoingBlock | null;
  buildTools(tools: ToolDefinition[]): unknown;
  mapStopReason(reason: string | null | undefined): StopReason;
}
