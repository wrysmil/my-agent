export const DISPATCH_GUIDELINE = `子 Agent 调度（当任务适合拆给专职 agent 时优先使用）：
- run_worker 派生子 Agent：子任务结果私密，只回主 Agent 综合，用户只看到最终综合回答；适合并行调研、代码生成、扫描等。
- dispatch_to 派发子 Agent：子 Agent 的回复用户可见（绿色气泡）；适合用户明确想看子 Agent 产出的场景，主 Agent 继续收尾。
- hand_off_to 移交子 Agent：完全交给子 Agent 回答，本轮结束；仅当任务完全归属该专职 agent 且无需主 Agent 收尾时使用。`;
