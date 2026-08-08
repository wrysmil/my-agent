import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

/**
 * icons.js 是经典 <script defer> 脚本（非 ES module），运行时挂到全局。
 * 这里用 node:vm 起一个干净的全局上下文来加载它 —— 既贴近浏览器的真实加载方式，
 * 又不需要 jsdom（本仓库未装 jsdom，且本 WU 不引入任何依赖）。
 * 断言全部针对返回的 SVG 字符串，不依赖 DOM。
 */
const ICONS_PATH = fileURLToPath(new URL("../../web/js/shared/icons.js", import.meta.url));
const ICONS_SOURCE = readFileSync(ICONS_PATH, "utf-8");

interface IconsGlobal {
  iconHtml: (name: string, size?: number) => string;
  hasIcon: (name: string) => boolean;
  ICON_NAMES: string[];
}

function loadIcons(warn: (...args: unknown[]) => void = () => {}): IconsGlobal {
  const sandbox: Record<string, unknown> = { console: { warn } };
  createContext(sandbox);
  runInContext(ICONS_SOURCE, sandbox);
  return sandbox as unknown as IconsGlobal;
}

/** spec § 4.4.6 + plan § 6.2 F4 的必备图标名 */
const REQUIRED_NAMES = [
  "send",
  "stop",
  "plus",
  "trash-2",
  "settings",
  "message-square",
  "history",
  "users",
  "sparkles",
  "zap",
  "search",
  "x",
  "check",
  "chevron-right",
  "chevron-down",
  "loader-2",
  "alert-triangle",
  "info",
  "check-circle-2",
  "x-circle",
] as const;

describe("icons.js — 全局导出", () => {
  it("挂载 iconHtml / hasIcon / ICON_NAMES 到全局", () => {
    const icons = loadIcons();
    expect(typeof icons.iconHtml).toBe("function");
    expect(typeof icons.hasIcon).toBe("function");
    expect(Array.isArray(icons.ICON_NAMES)).toBe(true);
  });

  it("至少提供 20 个图标，且无重名", () => {
    const { ICON_NAMES } = loadIcons();
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
  });

  it("覆盖 spec § 4.4.6 全部必备图标名", () => {
    const { ICON_NAMES } = loadIcons();
    const missing = REQUIRED_NAMES.filter((n) => !ICON_NAMES.includes(n));
    expect(missing).toEqual([]);
  });
});

describe("iconHtml — 每个图标返回合法 SVG", () => {
  it.each(REQUIRED_NAMES)("%s 返回非空 SVG 字符串", (name) => {
    const { iconHtml } = loadIcons();
    const html = iconHtml(name);

    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
    expect(html.startsWith("<svg")).toBe(true);
    expect(html.endsWith("</svg>")).toBe(true);
    // 必须有实际图形内容，不能是个空壳 <svg></svg>
    expect(html).toMatch(/<(path|circle|rect|line|polyline|polygon|ellipse)\b/);
  });

  it.each(REQUIRED_NAMES)("%s 满足 24×24 / stroke 约定", (name) => {
    const { iconHtml } = loadIcons();
    const html = iconHtml(name);

    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('stroke-width="2"');
    expect(html).toContain('fill="none"');
    expect(html).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(html).toContain('stroke-linecap="round"');
    expect(html).toContain('stroke-linejoin="round"');
  });

  it.each(REQUIRED_NAMES)("%s 标记为装饰性（aria-hidden）", (name) => {
    // accessibility-checklist：装饰性 SVG 不该被朗读；
    // 可访问名称由 icon-only button 自己的 aria-label 提供。
    const { iconHtml } = loadIcons();
    expect(iconHtml(name)).toContain('aria-hidden="true"');
  });
});

describe("iconHtml — size 参数", () => {
  it("默认 24×24", () => {
    const { iconHtml } = loadIcons();
    const html = iconHtml("send");
    expect(html).toContain('width="24"');
    expect(html).toContain('height="24"');
  });

  it.each([12, 16, 20, 32, 48])("size=%i 同时应用到 width 与 height", (size) => {
    const { iconHtml } = loadIcons();
    const html = iconHtml("check", size);
    expect(html).toContain(`width="${size}"`);
    expect(html).toContain(`height="${size}"`);
  });

  it("size 变化不影响 viewBox（恒为 24）", () => {
    const { iconHtml } = loadIcons();
    expect(iconHtml("zap", 64)).toContain('viewBox="0 0 24 24"');
  });

  it.each([0, -8, NaN, Infinity, "abc", null])(
    "非法 size (%s) 回退到 24",
    (size) => {
      const { iconHtml } = loadIcons();
      const html = iconHtml("plus", size as unknown as number);
      expect(html).toContain('width="24"');
      expect(html).toContain('height="24"');
    },
  );

  it("size 为字符串数字时正常解析，且不注入属性", () => {
    const { iconHtml } = loadIcons();
    const html = iconHtml("plus", '16" onload="alert(1)' as unknown as number);
    expect(html).not.toContain("onload");
    expect(html).toContain('width="24"');
  });
});

describe("iconHtml — 未知图标", () => {
  it("返回空字符串并 console.warn", () => {
    const warn = vi.fn();
    const { iconHtml } = loadIcons(warn);

    expect(iconHtml("no-such-icon")).toBe("");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("no-such-icon");
  });

  it.each(["", "toString", "constructor", "__proto__"])(
    "不把原型链属性 (%s) 当成图标",
    (name) => {
      const { iconHtml, hasIcon } = loadIcons();
      expect(hasIcon(name)).toBe(false);
      expect(iconHtml(name)).toBe("");
    },
  );
});

describe("hasIcon", () => {
  it("已知图标返回 true，未知返回 false", () => {
    const { hasIcon } = loadIcons();
    expect(hasIcon("send")).toBe(true);
    expect(hasIcon("nope")).toBe(false);
  });
});

describe("图标源码约定", () => {
  it("不含 emoji（spec § 2.2 反模式）", () => {
    expect(ICONS_SOURCE).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("不引入任何依赖（无 import / require）", () => {
    expect(ICONS_SOURCE).not.toMatch(/^\s*import\s/m);
    expect(ICONS_SOURCE).not.toMatch(/\brequire\s*\(/);
  });
});
