import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, "..");

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// 复制 preload 脚本（.cjs 后缀确保 CJS 加载，不受 root type:module 影响）
const preloadSrc = join(root, "electron", "preload.cjs");
const preloadDst = join(root, "dist", "electron", "preload.cjs");
if (existsSync(preloadSrc)) {
  ensureDir(dirname(preloadDst));
  cpSync(preloadSrc, preloadDst);
  console.log("[copy-assets] preload.cjs → dist/electron/");
}

// 复制 main.cjs 入口（CJS wrapper，解决 electron 模块 ESM/CJS 兼容问题）
const mainSrc = join(root, "electron", "main.cjs");
const mainDst = join(root, "dist", "electron", "main.cjs");
if (existsSync(mainSrc)) {
  ensureDir(dirname(mainDst));
  cpSync(mainSrc, mainDst);
  console.log("[copy-assets] main.cjs → dist/electron/");
}

// 复制 renderer 目录
const rendererSrc = join(root, "electron", "renderer");
const rendererDst = join(root, "dist", "electron", "renderer");
if (existsSync(rendererSrc)) {
  cpSync(rendererSrc, rendererDst, { recursive: true });
  console.log("[copy-assets] renderer/ → dist/electron/renderer/");
}

console.log("[copy-assets] done.");
