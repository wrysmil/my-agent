import * as path from "node:path";

export interface SandboxOptions {
  allowedRoots: readonly string[];
}

/**
 * 检查候选路径是否在允许根内。
 *
 * - 两侧 path.resolve 规范化（不做 realpath，学习项目无需 symlink 防御）
 * - 用 startsWith(root + sep) 防止前缀碰撞
 * - 空输入、相对路径、空根列表 → false
 */
export function isPathAllowed(candidate: string, opts: SandboxOptions): boolean {
  if (!candidate || !path.isAbsolute(candidate)) return false;
  if (!opts.allowedRoots.length) return false;

  // .. 段快速拒绝
  if (candidate.split(path.sep).includes("..")) return false;

  const resolved = path.resolve(candidate);

  for (const root of opts.allowedRoots) {
    if (!root) continue;
    const resolvedRoot = path.resolve(root);
    if (
      resolved === resolvedRoot ||
      resolved.startsWith(resolvedRoot + path.sep)
    ) {
      return true;
    }
  }
  return false;
}

/** 统一门控入口：放行返回 null，拒绝返回错误消息 */
export function guardPath(abs: string, opts: SandboxOptions): string | null {
  if (isPathAllowed(abs, opts)) return null;

  const roots = opts.allowedRoots.map((r) => r || "(empty)").join(", ");
  return [
    `E_PATH_OUT_OF_SCOPE: path is outside the allowed scope.`,
    `  path: ${abs}`,
    `  allowed root(s): ${roots}`,
  ].join("\n");
}
