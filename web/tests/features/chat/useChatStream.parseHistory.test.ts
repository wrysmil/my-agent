/**
 * parseHistoryMessages 后处理 — history 路径下的 dispatch agent 气泡重建。
 *
 * 背景：JSONL 持久化层未存 agent_message SSE 事件。
 * 刷新页面 / refetch 时必须靠 dispatch_to / hand_off_to 的 tool_call + tool_result
 * 自重建 role:'agent' 消息，否则子 Agent 输出凭空消失。
 *
 * 关注：bubbles 生成、剥 XML 信封、稳定 ID、actor 归属、isFinal 语义、
 * runId 透传、与已有 assistant 消息的相对位置。
 */

import { describe, it, expect } from 'vitest';
import type { SerializedMsg } from '@/features/chat/useChatStream';
import { parseHistoryMessages } from '@/features/chat/useChatStream';

interface Scb {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result';
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  toolUseId?: string;
  content?: string;
  isError?: boolean;
}

function text(id: string, text: string): Scb {
  return { type: 'text', id, text };
}

function toolUse(
  id: string,
  name: string,
  input: Record<string, unknown>,
): Scb {
  return { type: 'tool_use', id, name, input };
}

function toolResult(
  id: string,
  toolUseId: string,
  content: string,
  isError = false,
  name?: string,
): Scb {
  return { type: 'tool_result', id, toolUseId, content, isError, ...(name ? { name } : {}) };
}

function asMsg(
  role: 'user' | 'assistant',
  content: Scb[],
  extras: { id?: string; runId?: string } = {},
): SerializedMsg {
  return { role, content, ...extras };
}

describe('parseHistoryMessages — dispatch agent bubbles reconstruction', () => {
  it('[history 路径 dispatch_to] 把 tool_call + tool_result 配对成独立 role=agent 消息', () => {
    const raw: SerializedMsg[] = [
      asMsg('user', [text('u1', '请 Coder 写个 travel.html')], { id: 'u-1' }),
      asMsg('assistant', [
        text('a1', '好的，我先派给 Coder'),
        toolUse('tu1', 'dispatch_to', { to: 'coder', prompt: '写 travel.html' }),
      ], { id: 'asst-1', runId: 'run-1' }),
      // 真实 JSONL：tool_result 在 user row，且与同 runId 的 assistant row 通过 groupKey 合并
      asMsg('user', [
        toolResult('tr1', 'tu1', '<worker-result>已写入 travel.html</worker-result>', false, 'dispatch_to'),
      ], { id: 'tu-1-result', runId: 'run-1' }),
    ];

    const result = parseHistoryMessages(raw);

    // 期望顺序：user / assistant(合并 tool_use + tool_result) / agent
    expect(result.map((m) => m.role)).toEqual(['user', 'assistant', 'agent']);
    const agentMsg = result[2];
    expect(agentMsg.role).toBe('agent');
    expect(agentMsg.text).toBe('已写入 travel.html'); // XML 信封已剥
    expect(agentMsg.actorName).toBe('coder');
    expect(agentMsg.runId).toBe('run-1');
    expect(agentMsg.isFinal).toBe(false);
    // 稳定 ID
    expect(agentMsg.id).toBe('hist-agent-tu1');
  });

  it('[history 路径 hand_off_to] 生成的 agent 气泡 isFinal=true', () => {
    const raw: SerializedMsg[] = [
      asMsg('user', [text('u1', '完全交给 researcher')], { id: 'u-2' }),
      asMsg('assistant', [
        toolUse('tu9', 'hand_off_to', { to: 'researcher', prompt: '调研 X' }),
      ], { id: 'asst-2', runId: 'run-2' }),
      asMsg('user', [
        toolResult('tr9', 'tu9', '<worker-result>调研结论：Y</worker-result>', false, 'hand_off_to'),
      ], { id: 'tu-9-result', runId: 'run-2' }),
    ];

    const result = parseHistoryMessages(raw);

    const agentMsg = result.find((m) => m.role === 'agent');
    expect(agentMsg).toBeDefined();
    expect(agentMsg?.isFinal).toBe(true);
    expect(agentMsg?.text).toBe('调研结论：Y');
    expect(agentMsg?.actorName).toBe('researcher');
  });

  it('[history 路径 无 dispatch] 不会凭空生成 agent 消息', () => {
    const raw: SerializedMsg[] = [
      asMsg('user', [text('u1', '你好')], { id: 'u-3' }),
      asMsg('assistant', [
        text('a1', '你好，有什么可以帮你的？'),
      ], { id: 'asst-3', runId: 'run-3' }),
    ];

    const result = parseHistoryMessages(raw);

    expect(result.filter((m) => m.role === 'agent')).toHaveLength(0);
    expect(result.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('[history 路径 run_worker（非 dispatch）] 不被当作 agent 气泡', () => {
    const raw: SerializedMsg[] = [
      asMsg('user', [text('u1', '查一下文件')], { id: 'u-4' }),
      asMsg('assistant', [
        toolUse('tu-rw', 'run_worker', { to: 'coder', prompt: '查文件' }),
      ], { id: 'asst-4', runId: 'run-4' }),
      asMsg('user', [
        toolResult('tr-rw', 'tu-rw', '<worker-result>内部步骤摘要</worker-result>', false, 'run_worker'),
      ], { id: 'tu-rw-result', runId: 'run-4' }),
    ];

    const result = parseHistoryMessages(raw);

    // run_worker 不应该生成独立 agent 气泡（仅 dispatch_to / hand_off_to 才有可见回复）
    expect(result.filter((m) => m.role === 'agent')).toHaveLength(0);
    expect(result.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('[history 路径 混合] 一条 assistant 含多个 dispatch_to，每个都生成对应气泡', () => {
    const raw: SerializedMsg[] = [
      asMsg('user', [text('u1', '并行两个')], { id: 'u-5' }),
      asMsg('assistant', [
        toolUse('tu-a', 'dispatch_to', { to: 'coder', prompt: 'A' }),
        toolUse('tu-b', 'dispatch_to', { to: 'reviewer', prompt: 'B' }),
      ], { id: 'asst-5', runId: 'run-5' }),
      asMsg('user', [
        toolResult('tr-a', 'tu-a', '<worker-result>A 完成</worker-result>', false, 'dispatch_to'),
        toolResult('tr-b', 'tu-b', '<worker-result>B 完成</worker-result>', false, 'dispatch_to'),
      ], { id: 'tu-ab-result', runId: 'run-5' }),
    ];

    const result = parseHistoryMessages(raw);

    const agents = result.filter((m) => m.role === 'agent');
    expect(agents).toHaveLength(2);
    expect(agents[0].actorName).toBe('coder');
    expect(agents[0].text).toBe('A 完成');
    expect(agents[0].id).toBe('hist-agent-tu-a');
    expect(agents[1].actorName).toBe('reviewer');
    expect(agents[1].text).toBe('B 完成');
    expect(agents[1].id).toBe('hist-agent-tu-b');
  });

  it('[history 路径 信封剥除] worker-error 信封也走 stripWorkerEnvelope', () => {
    const raw: SerializedMsg[] = [
      asMsg('user', [text('u1', 'go')], { id: 'u-6' }),
      asMsg('assistant', [
        toolUse('tu-x', 'dispatch_to', { to: 'coder' }),
      ], { id: 'asst-6', runId: 'run-6' }),
      asMsg('user', [
        toolResult('tr-x', 'tu-x', '<worker-error>出错了：磁盘满</worker-error>', false, 'dispatch_to'),
      ], { id: 'tu-x-result', runId: 'run-6' }),
    ];

    const result = parseHistoryMessages(raw);

    const agent = result.find((m) => m.role === 'agent');
    expect(agent?.text).toBe('出错了：磁盘满');
  });

  it('[history 路径 无 tool_result] 跳过该 dispatch 调用，不生成空气泡', () => {
    const raw: SerializedMsg[] = [
      asMsg('user', [text('u1', 'go')], { id: 'u-7' }),
      asMsg('assistant', [
        toolUse('tu-y', 'dispatch_to', { to: 'coder' }),
      ], { id: 'asst-7', runId: 'run-7' }),
      // 没有对应的 tool_result row
    ];

    const result = parseHistoryMessages(raw);

    expect(result.filter((m) => m.role === 'agent')).toHaveLength(0);
  });

  it('[history 路径 位置] agent 气泡插在对应 assistant 之后，不打乱顺序', () => {
    const raw: SerializedMsg[] = [
      asMsg('user', [text('u1', 'first')], { id: 'u-A' }),
      asMsg('assistant', [
        text('a1', 'reply 1'),
      ], { id: 'asst-A', runId: 'run-A' }),
      asMsg('user', [text('u2', 'second')], { id: 'u-B' }),
      asMsg('assistant', [
        text('a2', 'reply 2'),
        toolUse('tu-z', 'dispatch_to', { to: 'coder' }),
      ], { id: 'asst-B', runId: 'run-B' }),
      asMsg('user', [
        toolResult('tr-z', 'tu-z', '<worker-result>reply 2 的子 Agent 输出</worker-result>', false, 'dispatch_to'),
      ], { id: 'tu-z-result', runId: 'run-B' }),
    ];

    const result = parseHistoryMessages(raw);

    // 期望顺序：u1 / asst-A / u2 / asst-B / agent(B)
    expect(result.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'agent']);
    const agent = result[4];
    expect(agent.text).toBe('reply 2 的子 Agent 输出');
    // 关键：agent 出现在 asst-B 之后，但在 asst-A 之前没有 agent（位置正确）
    const asstAIdx = result.findIndex((m) => m.id === 'hist-asst-A');
    const asstBIdx = result.findIndex((m) => m.id === 'hist-asst-B');
    expect(agent.runId).toBe('run-B');
    expect(asstBIdx).toBeLessThan(result.indexOf(agent));
    expect(result.indexOf(agent)).toBeGreaterThan(asstAIdx);
  });

  it('[WU-04 dispatch_to 归主 Agent] 重建 agent 气泡 blocks 留空：dispatch_to 不再进入 agent 气泡', () => {
    const raw: SerializedMsg[] = [
      asMsg('user', [text('u1', '请 Coder 写个 travel.html')], { id: 'u-1' }),
      asMsg('assistant', [
        text('a1', '好的，我先派给 Coder'),
        toolUse('tu1', 'dispatch_to', { to: 'coder', prompt: '写 travel.html' }),
      ], { id: 'asst-1', runId: 'run-1' }),
      asMsg('user', [
        toolResult('tr1', 'tu1', '<worker-result>已写入 travel.html</worker-result>', false, 'dispatch_to'),
      ], { id: 'tu-1-result', runId: 'run-1' }),
    ];

    const result = parseHistoryMessages(raw);

    const agent = result.find((m) => m.role === 'agent');
    expect(agent).toBeDefined();
    // dispatch_to 是主 Agent 的派发动作，不进入 agent 气泡 blocks：
    // 修复后与 live 路径（dispatch_started → blocks=[]）一致，避免视觉错位。
    expect(agent?.blocks).toEqual([]);
    // 派生字段保留
    expect(agent?.toolName).toBe('dispatch_to');
    expect(agent?.actorName).toBe('coder');
    expect(agent?.isFinal).toBe(false);
    expect(agent?.text).toBe('已写入 travel.html');
    expect(agent?.status).toBe('done');

    // dispatch_to 的 tool_call + tool_result 应归主 Agent 气泡（历史路径同 live 路径）：
    const assistant = result.find((m) => m.role === 'assistant');
    expect(
      assistant?.blocks.some((b) => b.type === 'tool_call' && b.toolName === 'dispatch_to' && b.toolId === 'tu1'),
    ).toBe(true);
    expect(
      assistant?.blocks.some((b) => b.type === 'tool_result' && b.toolCallId === 'tu1'),
    ).toBe(true);
  });

  it('[WU-04 run_worker] 不生成 agent 气泡，run_worker 的 tool_call/tool_result 保留在主 Agent 气泡', () => {
    const raw: SerializedMsg[] = [
      asMsg('user', [text('u1', '查一下文件')], { id: 'u-1' }),
      asMsg('assistant', [
        toolUse('tu-rw', 'run_worker', { to: 'coder', prompt: '查文件' }),
      ], { id: 'asst-1', runId: 'run-1' }),
      asMsg('user', [
        toolResult('tr-rw', 'tu-rw', '<worker-result>内部步骤摘要</worker-result>', false, 'run_worker'),
      ], { id: 'tu-rw-result', runId: 'run-1' }),
    ];

    const result = parseHistoryMessages(raw);

    // run_worker 无可见回复 → 不创建 agent 气泡
    expect(result.filter((m) => m.role === 'agent')).toHaveLength(0);
    // 但 run_worker 的 tool_call/tool_result 保留在主 Agent 气泡内（trace 可见）
    const assistant = result.find((m) => m.role === 'assistant');
    expect(assistant?.blocks.some((b) => b.type === 'tool_call' && b.toolName === 'run_worker')).toBe(true);
    expect(assistant?.blocks.some((b) => b.type === 'tool_result' && b.toolCallId === 'tu-rw')).toBe(true);
  });

  it('[WU-04 主 Agent 多气泡] #1 等待态 + #2 收尾（同 runId 不同 messageId）分离归位，不合并、不空气泡', () => {
    const raw: SerializedMsg[] = [
      asMsg('user', [text('u1', '请 Coder 写个 travel.html')], { id: 'u-1' }),
      // #1 等待态：派发通知 + dispatch_to tool_call
      asMsg('assistant', [
        text('a1', '好的，我先派给 Coder'),
        toolUse('tu1', 'dispatch_to', { to: 'coder', prompt: '写 travel.html' }),
      ], { id: 'asst-1', runId: 'run-1' }),
      asMsg('user', [
        toolResult('tr1', 'tu1', '<worker-result>已写入 travel.html</worker-result>', false, 'dispatch_to'),
      ], { id: 'tu-1-result', runId: 'run-1' }),
      // #2 收尾：主 Agent 恢复后最终回复（同 runId，不同 messageId）
      asMsg('assistant', [
        text('a2', 'Coder 已完成，travel.html 已就绪。'),
      ], { id: 'asst-2', runId: 'run-1' }),
    ];

    const result = parseHistoryMessages(raw);

    // 期望顺序：user / assistant#1 / agent / assistant#2（agent 归位在 #1 之后、#2 之前）
    expect(result.map((m) => m.role)).toEqual(['user', 'assistant', 'agent', 'assistant']);
    // #1 与 #2 不合并为同一气泡
    const assistants = result.filter((m) => m.role === 'assistant');
    expect(assistants).toHaveLength(2);
    expect(assistants[0].messageId).toBe('asst-1');
    expect(assistants[1].messageId).toBe('asst-2');
    expect(assistants[0].id).toBe('hist-asst-1');
    expect(assistants[1].id).toBe('hist-asst-2');
    // #1 含 dispatch tool_call + tool_result（配对 tool_result 归位到 #1）
    expect(
      assistants[0].blocks.some((b) => b.type === 'tool_call' && b.toolName === 'dispatch_to'),
    ).toBe(true);
    expect(
      assistants[0].blocks.some((b) => b.type === 'tool_result' && b.toolCallId === 'tu1'),
    ).toBe(true);
    // #2 只有收尾 text，无空气泡
    expect(assistants[1].blocks.every((b) => b.type === 'text')).toBe(true);
    expect(assistants[1].blocks.length).toBeGreaterThan(0);
    // agent 气泡位于 #1 与 #2 之间
    const agentIdx = result.findIndex((m) => m.role === 'agent');
    expect(agentIdx).toBe(2);
  });

  it('[WU-04 主 Agent 多气泡] #1/#2 同 runId 但无 id（旧 JSONL）回退 runId 分组不生成空气泡', () => {
    const raw: SerializedMsg[] = [
      asMsg('user', [text('u1', 'go')], { id: 'u-1' }),
      // 旧 JSONL 无 id：仅 runId，两条 assistant 按 runId 回退合并（不生成空气泡）
      asMsg('assistant', [
        text('a1', '我先派给 Coder'),
        toolUse('tu1', 'dispatch_to', { to: 'coder' }),
      ], { runId: 'run-1' }),
      asMsg('user', [
        toolResult('tr1', 'tu1', '<worker-result>完成</worker-result>', false, 'dispatch_to'),
      ], { runId: 'run-1' }),
      asMsg('assistant', [
        text('a2', '收尾'),
      ], { runId: 'run-1' }),
    ];

    const result = parseHistoryMessages(raw);

    // 无 messageId 时回退 runId 分组：两条 assistant 合并为一条，但 agent 气泡仍正确生成，无空气泡
    const roles = result.map((m) => m.role);
    expect(roles).toEqual(['user', 'assistant', 'agent']);
    const assistant = result.find((m) => m.role === 'assistant');
    expect(assistant?.blocks.some((b) => b.type === 'tool_call')).toBe(true);
    expect(assistant?.blocks.some((b) => b.type === 'tool_result')).toBe(true);
  });

  // ---------------------------------------------------------------------
  // 冒烟回归：history 重构 agent 气泡时，dispatch_to 必须从 agent 气泡排除
  // 之前 rebuildDispatchAgentMessages 故意把 dispatch_to tool_call+tool_result
  // 推进 agent 气泡的 blocks，导致 history refetch 后 Coder 子气泡里出现
  // "dispatch_to" 工具行（视觉错位）。修复后：agent 气泡 blocks 留空，
  // dispatch_to 仅出现在主 Agent 气泡，与 live 路径一致。
  // ---------------------------------------------------------------------
  it('[smoke] history 路径 agent 气泡不含 dispatch_to 工具行；dispatch_to 归主 Agent', () => {
    const raw: SerializedMsg[] = [
      asMsg('user', [text('u1', '请 Coder 写 React 旅游页')], { id: 'u-1' }),
      asMsg(
        'assistant',
        [
          text('a1', '好的，我先派给 Coder'),
          toolUse('tu1', 'dispatch_to', { to: 'coder', prompt: '写 React 旅游页' }),
        ],
        { id: 'asst-1', runId: 'run-1' },
      ),
      asMsg(
        'user',
        [
          toolResult(
            'tr1',
            'tu1',
            '<worker-result>已写入 50 行 React 旅游页</worker-result>',
            false,
            'dispatch_to',
          ),
        ],
        { id: 'tu-1-result', runId: 'run-1' },
      ),
    ];

    const result = parseHistoryMessages(raw);

    // 1) agent 气泡存在且 text 是剥信封后的 worker 回复
    const agent = result.find((m) => m.role === 'agent');
    expect(agent).toBeDefined();
    expect(agent?.text).toBe('已写入 50 行 React 旅游页');
    expect(agent?.actorName).toBe('coder');
    expect(agent?.toolName).toBe('dispatch_to');

    // 2) ★ 核心冒烟：agent 气泡 blocks 留空，不含 dispatch_to
    expect(agent?.blocks).toEqual([]);
    expect(
      agent?.blocks.some((b) => 'toolName' in b && b.toolName === 'dispatch_to'),
    ).toBe(false);
    expect(
      agent?.blocks.some((b) => b.type === 'tool_result'),
    ).toBe(false);

    // 3) dispatch_to 的 tool_call + tool_result 必须在主 Agent 气泡（不丢）
    const assistant = result.find((m) => m.role === 'assistant');
    expect(assistant).toBeDefined();
    expect(
      assistant?.blocks.some(
        (b) => b.type === 'tool_call' && b.toolName === 'dispatch_to' && b.toolId === 'tu1',
      ),
    ).toBe(true);
    expect(
      assistant?.blocks.some(
        (b) => b.type === 'tool_result' && b.toolCallId === 'tu1',
      ),
    ).toBe(true);
  });

  it('[smoke] hand_off_to 同样不再挤入 agent 气泡 blocks（isFinal=true 保留）', () => {
    const raw: SerializedMsg[] = [
      asMsg('user', [text('u1', '完全交给 researcher')], { id: 'u-2' }),
      asMsg(
        'assistant',
        [toolUse('tu9', 'hand_off_to', { to: 'researcher', prompt: '调研 X' })],
        { id: 'asst-2', runId: 'run-2' },
      ),
      asMsg(
        'user',
        [
          toolResult(
            'tr9',
            'tu9',
            '<worker-result>调研结论：Y</worker-result>',
            false,
            'hand_off_to',
          ),
        ],
        { id: 'tu-9-result', runId: 'run-2' },
      ),
    ];

    const result = parseHistoryMessages(raw);

    const agent = result.find((m) => m.role === 'agent');
    expect(agent).toBeDefined();
    // hand_off_to 语义保留：agent 气泡 isFinal=true
    expect(agent?.isFinal).toBe(true);
    // 但 hand_off_to 也不再挤入 agent 气泡 blocks
    expect(agent?.blocks).toEqual([]);
    expect(
      agent?.blocks.some((b) => 'toolName' in b && b.toolName === 'hand_off_to'),
    ).toBe(false);
    // 文本仍是剥信封后的 worker 实际回复
    expect(agent?.text).toBe('调研结论：Y');
  });
});