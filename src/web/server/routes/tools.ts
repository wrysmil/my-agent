/**
 * my-agent Web 前端 — Tools 域 GET 路由（tools-management-page）。
 *
 * 来源：spec 2026-08-08-tools-management-page-spec § 4。
 *
 * 数据源为 BUILTIN_TOOLS 常量（src/tools/builtin.ts），无外部依赖。
 * - GET /api/tools      → 工具摘要列表（name, description, executionMode）
 * - GET /api/tools/:name → 单个工具完整信息（含 inputSchema）
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { BUILTIN_TOOLS } from "../../../tools/builtin.js";

export async function listToolsHandler(
  _req: IncomingMessage,
  res: ServerResponse,
  _params: Record<string, string>,
): Promise<void> {
  const tools = BUILTIN_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    ...(t.executionMode ? { executionMode: t.executionMode } : {}),
  }));

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ ok: true, data: { tools } }));
}

export async function getToolHandler(
  _req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
): Promise<void> {
  const name = params.name;
  const tool = BUILTIN_TOOLS.find((t) => t.name === name);

  if (!tool) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        ok: false,
        error: { code: "TOOL_NOT_FOUND", message: `工具不存在: ${name}` },
      }),
    );
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(
    JSON.stringify({
      ok: true,
      data: {
        tool: {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          ...(tool.executionMode ? { executionMode: tool.executionMode } : {}),
        },
      },
    }),
  );
}
