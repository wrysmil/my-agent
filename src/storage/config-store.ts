/**
 * ConfigStore — 统一的 config.json 文件读写模块
 *
 * 职责：仅负责应用配置 JSON 文件的原始读写（不含 Zod 校验）；
 * 校验与默认值合并由 `../config/loader.ts`（loadConfig / createConfig）完成。
 *
 * 接口：
 * - readConfigFile(configPath)  → Record<string, unknown> | null
 * - writeConfigFile(configPath, data) → void（原子写入）
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWrite } from "./jsonl.js";

/**
 * 读取 config JSON 文件。
 *
 * 文件不存在、内容不是合法 JSON 对象时返回 null（调用方自行降级处理）。
 * 调用方应优先将结果作为配置源；返回 null 表示"无文件"，可用 SQLite 等兜底。
 *
 * @param configPath — config.json 的绝对路径
 * @returns 配置对象；读取失败返回 null
 */
export function readConfigFile(
  configPath: string,
): Record<string, unknown> | null {
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf-8");
  } catch {
    // ENOENT / 无权限等一律视为无文件
    return null;
  }
  try {
    const data = JSON.parse(raw);
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return data as Record<string, unknown>;
    }
    return null;
  } catch {
    // JSON 语法错误 → 降级为无文件，避免向调用方抛错
    return null;
  }
}

/**
 * 将配置对象写回 config JSON 文件（原子写入，自动创建父目录）。
 *
 * 使用 tempfile + rename 原子替换，避免中途崩溃产生半写文件。
 *
 * @param configPath — config.json 的绝对路径
 * @param data — 要写入的配置对象
 */
export function writeConfigFile(
  configPath: string,
  data: Record<string, unknown>,
): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  atomicWrite(configPath, JSON.stringify(data, null, 2));
}
