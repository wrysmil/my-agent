/**
 * Prompt 模板加载器。
 *
 * 模板位于 `src/prompts/templates/<name>.md`，使用 `$variable` 占位符
 * （移植自 Python `string.Template` — 正文可含字面量 `{}` 而无需转义，
 *  遗漏的参数会保留字面量而非崩溃）。
 *
 * 替换规则（与 Python `string.Template.safe_substitute` 一致）：
 *   - `$identifier`   → 从 args 替换
 *   - `${identifier}` → 从 args 替换
 *   - `$$`            → 字面量 `$`
 *   - 未知 id         → 保留字面量（如 `$foo` 仍为 `$foo`）
 *   - identifier      → `[A-Za-z_][A-Za-z0-9_]*`
 *
 * 已加载模板按名称缓存，并以文件 mtime 为键，因此磁盘上编辑 .md
 * 无需重启即可生效。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ============================================================
// 模板目录解析
// ============================================================

/** 默认模板目录：本文件所在目录下的 templates/ */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_TEMPLATES_DIR = path.join(__dirname, "templates");

// ============================================================
// 占位符正则
// ============================================================

/** 匹配 `$id`、`${id}`、`$$` 三种模式 */
const TEMPLATE_RE =
  /\$(\$|\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g;

// ============================================================
// 类型
// ============================================================

/** 模板替换参数，值会被转为字符串 */
export type TemplateArgs = Record<string, string | number | boolean>;

// ============================================================
// safeSubstitute — 核心替换函数
// ============================================================

/**
 * 对模板正文执行安全替换。
 *
 * - 已知变量 → 替换为对应值
 * - `$$` → 字面量 `$`
 * - 未知变量 → 保留原样（不抛异常）
 *
 * @param body — 模板原始文本
 * @param args — 替换参数映射
 * @returns 替换后的文本
 */
export function safeSubstitute(body: string, args: TemplateArgs): string {
  return body.replace(
    TEMPLATE_RE,
    (match, _g1, braced: string | undefined, named: string | undefined) => {
      if (match === "$$") return "$";
      const key = braced || named;
      if (key && Object.prototype.hasOwnProperty.call(args, key)) {
        return String(args[key]);
      }
      return match; // 未知 → 保留字面量
    },
  );
}

// ============================================================
// 缓存条目
// ============================================================

interface CacheEntry {
  /** 文件修改时间（毫秒） */
  mtime: number;
  /** 文件正文 */
  body: string;
}

// ============================================================
// PromptManager 类
// ============================================================

/**
 * Prompt 模板管理器。
 *
 * 负责加载、缓存和渲染 `.md` 模板文件。
 * 通过 mtime 实现热更新：磁盘编辑后下次 `load()` 自动生效。
 *
 * @example
 * ```ts
 * import { prompts } from "./prompts/loader.js";
 *
 * // 加载 base-agent.md 模板并填充变量
 * const prompt = prompts.load("base-agent", {
 *   name: "MyAgent",
 *   working_dir: "/home/user/project",
 * });
 * ```
 */
export class PromptManager {
  /** 模板文件根目录 */
  readonly root: string;

  /** 模板缓存：name → { mtime, body } */
  private _cache: Map<string, CacheEntry>;

  /**
   * @param root — 模板文件所在目录的绝对路径。
   *   不传则使用本文件所在目录下的 `templates/`。
   */
  constructor(root?: string) {
    this.root = root || DEFAULT_TEMPLATES_DIR;
    this._cache = new Map();
  }

  /** 获取模板文件的绝对路径 */
  private _pathFor(template: string): string {
    return path.join(this.root, `${template}.md`);
  }

  /** 读取模板正文（含缓存） */
  private _body(template: string): string {
    const p = this._pathFor(template);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(p);
    } catch {
      return "";
    }
    const mtime = stat.mtimeMs;
    const cached = this._cache.get(template);
    if (cached && cached.mtime === mtime) return cached.body;

    let body: string;
    try {
      body = fs.readFileSync(p, "utf8");
    } catch {
      return "";
    }
    this._cache.set(template, { mtime, body });
    return body;
  }

  /**
   * 检查模板文件是否存在。
   *
   * @param template — 模板名称（不含 `.md` 后缀）
   * @returns 文件存在则 true
   */
  exists(template: string): boolean {
    return fs.existsSync(this._pathFor(template));
  }

  /**
   * 加载并渲染模板。
   *
   * 从 `<root>/<template>.md` 读取文件，用 args 替换所有占位符后返回。
   * 模板按 mtime 缓存，磁盘编辑后自动生效。
   *
   * @param template — 模板名称（不含 `.md` 后缀）
   * @param args — 替换参数，key → value 映射
   * @returns 渲染后的文本。模板不存在时返回空字符串。
   *
   * @example
   * ```ts
   * const text = prompts.load("base-agent", {
   *   name: "coder",
   *   working_dir: "/src",
   * });
   * ```
   */
  load(template: string, args: TemplateArgs = {}): string {
    return safeSubstitute(this._body(template), args || {});
  }

  /**
   * 清空全部模板缓存。
   *
   * 下次 `load()` 将强制从磁盘重新读取所有模板。
   * 用于开发模式下强制刷新或测试清理。
   */
  reload(): void {
    this._cache.clear();
  }
}

/**
 * 全局 PromptManager 单例。
 *
 * 使用默认模板目录（`src/prompts/templates/`）。
 * 大多数场景直接使用此单例即可，无需自行 new PromptManager。
 *
 * @example
 * ```ts
 * import { prompts } from "./prompts/loader.js";
 * const text = prompts.load("base-agent", { name: "helper" });
 * ```
 */
export const prompts = new PromptManager();
