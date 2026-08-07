/**
 * 执行计划工具（manage_execution_plan）
 *
 * 为长时任务维护一份持久化的执行计划：
 * - action="update"：写入/修订步骤列表，必要时替换已存目标
 * - action="clear"：清空执行计划
 *
 * controller 由宿主注入，负责执行计划的持久化与存取。
 */

import { defineTool } from "./base.js";

export type ExecutionPlanStep = { step: string; status: string };

export type ExecutionPlanController = {
  update: (update: {
    steps?: Array<ExecutionPlanStep>;
    replace_objective?: boolean;
    explanation?: string;
    objectiveUserMessageDigest?: string;
  }) => { ok: boolean; error?: string };
  clear: () => void;
};

export function createExecutionPlanTool(controller: ExecutionPlanController) {
  return defineTool({
    name: "manage_execution_plan",
    description: `Maintain a durable execution plan for long-running tasks.
Use action="update" to record or revise the ordered step list (max 12 steps, each step max 180 chars) and optionally replace the stored objective when the user gives a new overall instruction (replace_objective). Use action="clear" to reset the plan.`,
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["update", "clear"],
          description: '"update" 写入或修订执行计划；"clear" 清空执行计划',
        },
        plan: {
          type: "array",
          items: {
            type: "object",
            properties: {
              step: { type: "string", maxLength: 180, description: "单个步骤的简短描述" },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed", "blocked"],
                description: "步骤状态",
              },
            },
            required: ["step", "status"],
          },
          maxItems: 12,
          description: "有序步骤列表（最多 12 项）",
        },
        replace_objective: {
          type: "boolean",
          description: "仅当用户发出新的整体指令/目标时才可设为 true",
        },
        explanation: {
          type: "string",
          maxLength: 500,
          description: "对本次更新的可选说明（供宿主记录）",
        },
      },
      required: ["action"],
    },
    execute: async (input, _ctx) => {
      const action = input.action as string;

      if (action === "clear") {
        controller.clear();
        return { content: "Execution plan cleared." };
      }

      if (action === "update") {
        const result = controller.update({
          steps: input.plan as Array<ExecutionPlanStep> | undefined,
          replace_objective: input.replace_objective === true,
          explanation:
            typeof input.explanation === "string" ? input.explanation : undefined,
        });
        if (result.ok) {
          return { content: "Execution plan updated." };
        }
        return {
          content: `Failed to update execution plan: ${result.error ?? "unknown error"}`,
          isError: true,
        };
      }

      return {
        content: `Unknown action "${action}". Use "update" or "clear".`,
        isError: true,
      };
    },
  });
}
