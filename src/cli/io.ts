import type { Interface as RLInterface } from "node:readline";

// ============================================================================
// 颜色
// ============================================================================

const NUMERALS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

function isColorEnabled(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR === "0") return false;
  return process.stdout.isTTY !== false;
}

/** 用指定 ANSI 颜色包裹文本。NO_COLOR 或非 TTY 时返回纯文本。 */
export function colorize(text: string, code: number): string {
  if (!isColorEnabled()) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

/** 渲染数字彩菜单编号：颜色 30+code 循环。 */
export function colorNumber(n: number, code: number): string {
  const numeral = NUMERALS[n - 1] ?? `${n}`;
  return colorize(numeral, code);
}

const CYCLE = [36, 32, 33, 34, 35, 31]; // 青绿黄蓝紫红

export function menuColor(n: number): number {
  return CYCLE[(n - 1) % CYCLE.length];
}

// ============================================================================
// 横幅 & 菜单项
// ============================================================================

export function formatBanner(title: string, width = 41): string {
  const inner = `  ${title}  `;
  const pad = Math.max(0, width - inner.length);
  const left = Math.floor(pad / 2);
  const right = pad - left;
  const top = "┌" + "─".repeat(width - 2) + "┐";
  const mid = "│" + " ".repeat(left) + inner + " ".repeat(right) + "│";
  const bot = "└" + "─".repeat(width - 2) + "┘";
  return `${top}\n${mid}\n${bot}`;
}

export function formatMenuItem(n: number, label: string, color?: number): string {
  const code = color ?? menuColor(n);
  return `  ${colorNumber(n, code)} ${label}`;
}

// ============================================================================
// 输入
// ============================================================================

export function prompt(rl: RLInterface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

export async function confirm(rl: RLInterface, question: string, defaultYes = false): Promise<boolean> {
  const suffix = defaultYes ? "(Y/n)" : "(y/N)";
  const ans = await prompt(rl, `${question} ${suffix}: `);
  if (!ans) return defaultYes;
  return /^[yY]/.test(ans);
}

/** 提示输入密文（不回显）。用 readline 模拟，简化版：直接读取。 */
export async function promptSecret(rl: RLInterface, question: string): Promise<string> {
  process.stdout.write(question);
  return new Promise((resolve) => {
    rl.question("", (answer) => {
      resolve(answer.trim());
    });
  });
}
