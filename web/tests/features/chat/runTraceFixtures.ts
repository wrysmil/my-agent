/**
 * Run Trace 矩阵测试共享 fixture（仅构造数据，无业务逻辑）。
 */
import type {
  Block,
  ChatMessage,
  ThinkingBlock,
  ToolCallBlock,
  ToolResultBlock,
  TextBlock,
} from '@/features/chat/types';

export function thinking(
  partial: Partial<ThinkingBlock> & Pick<ThinkingBlock, 'id' | 'thinking'>,
): ThinkingBlock {
  return {
    type: 'thinking',
    status: 'done',
    collapsed: true,
    ...partial,
  };
}

export function toolCall(
  partial: Partial<ToolCallBlock> & Pick<ToolCallBlock, 'id' | 'toolId' | 'toolName'>,
): ToolCallBlock {
  return {
    type: 'tool_call',
    status: 'done',
    inputRaw: '',
    ...partial,
  };
}

export function toolResult(
  partial: Partial<ToolResultBlock> & Pick<ToolResultBlock, 'id' | 'toolCallId' | 'toolName'>,
): ToolResultBlock {
  return {
    type: 'tool_result',
    status: 'done',
    content: '',
    isError: false,
    ...partial,
  };
}

export function textBlock(
  partial: Partial<TextBlock> & Pick<TextBlock, 'id' | 'text'>,
): TextBlock {
  return {
    type: 'text',
    status: 'done',
    ...partial,
  };
}

export function assistantMessage(
  blocks: Block[],
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    blocks,
    ...overrides,
  };
}

/** 与 isolation 历史恢复同构：thinking → tool_call → tool_result → text */
export function historyToolLoopBlocks(): Block[] {
  return [
    thinking({ id: 'thinking-a', thinking: 'researching the page' }),
    toolCall({
      id: 'tool-a',
      toolId: 'tool-a',
      toolName: 'web_fetch',
      inputRaw: '{"url":"https://example.com"}',
      input: { url: 'https://example.com' },
    }),
    toolResult({
      id: 'result-a',
      toolCallId: 'tool-a',
      toolName: 'web_fetch',
      content: 'page body',
    }),
    textBlock({ id: 'final-a', text: 'final answer from history' }),
  ];
}
