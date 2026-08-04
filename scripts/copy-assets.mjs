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

// 复制 preload 脚本
const preloadSrc = join(root, "electron", "preload.js");
const preloadDst = join(root, "dist", "electron", "preload.js");
if (existsSync(preloadSrc)) {
  ensureDir(dirname(preloadDst));
  cpSync(preloadSrc, preloadDst);
  console.log("[copy-assets] preload.js → dist/electron/");
}

// 复制 renderer 目录
const rendererSrc = join(root, "electron", "renderer");
const rendererDst = join(root, "dist", "electron", "renderer");
if (existsSync(rendererSrc)) {
  cpSync(rendererSrc, rendererDst, { recursive: true });
  console.log("[copy-assets] renderer/ → dist/electron/renderer/");
}

// 保留 electron/package.json（确保 preload 按 CJS 加载）
const pkgSrc = join(root, "electron", "package.json");
const pkgDst = join(root, "dist", "electron", "package.json");
if (existsSync(pkgSrc)) {
  cpSync(pkgSrc, pkgDst);
  console.log("[copy-assets] package.json → dist/electron/");
}

console.log("[copy-assets] done.");
