import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

// ---- 根目录 ----

let _dataRoot: string | undefined;

export function dataRoot(): string {
  if (_dataRoot !== undefined) return _dataRoot;
  _dataRoot = process.env.MY_AGENT_HOME ?? path.join(os.homedir(), ".my-agent");
  return _dataRoot;
}

/** 仅测试用：重置 dataRoot 缓存 */
export function _resetDataRoot(): void {
  _dataRoot = undefined;
}

// ---- 子目录 ----

export function sessionsDir(): string {
  return path.join(dataRoot(), "sessions");
}

export function logsDir(): string {
  return path.join(dataRoot(), "logs");
}

export function tmpDir(): string {
  return path.join(dataRoot(), "tmp");
}

// ---- 文件路径 ----

export function sessionFile(sessionId: string): string {
  assertPathSegment(sessionId, "sessionId");
  return path.join(sessionsDir(), `${sessionId}.jsonl`);
}

export function contextFile(sessionId: string): string {
  assertPathSegment(sessionId, "sessionId");
  return path.join(sessionsDir(), `${sessionId}.context.json`);
}

export function providersFile(): string {
  return path.join(dataRoot(), "providers.json");
}

export function configFile(): string {
  return path.join(dataRoot(), "config.json");
}

// ---- 布局确保 ----

let _layoutEnsured = false;

export function ensureDataLayout(): void {
  if (_layoutEnsured) return;
  for (const dir of [sessionsDir(), logsDir(), tmpDir()]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  _layoutEnsured = true;
}

// ---- 防御性校验 ----

const FORBIDDEN_IN_SEGMENT = /[\/\\\0]/;

/** 验证路径段不包含路径穿越字符。通过则原样返回，否则抛出。 */
export function assertPathSegment(segment: string, label: string): string {
  if (!segment || typeof segment !== "string") {
    throw new Error(`invalid ${label} for path: ${JSON.stringify(segment)}`);
  }
  if (segment.includes("..")) {
    throw new Error(
      `invalid ${label} for path (contains ".."): ${JSON.stringify(segment)}`,
    );
  }
  if (FORBIDDEN_IN_SEGMENT.test(segment)) {
    throw new Error(
      `invalid ${label} for path (forbidden char): ${JSON.stringify(segment)}`,
    );
  }
  return segment;
}
