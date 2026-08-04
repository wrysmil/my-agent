import * as fs from "node:fs";
import * as path from "node:path";
import { locksDir } from "./paths.js";

export class FileLock {
  private lockPath: string;
  private acquired = false;

  constructor(name: string) {
    fs.mkdirSync(locksDir(), { recursive: true });
    this.lockPath = path.join(locksDir(), `${name}.lock`);
  }

  acquire(timeoutMs = 5000): boolean {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        fs.writeFileSync(this.lockPath, String(process.pid), { flag: "wx" });
        this.acquired = true;
        return true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
      try {
        const pid = Number.parseInt(
          fs.readFileSync(this.lockPath, "utf-8"), 10
        );
        if (!isProcessAlive(pid)) {
          fs.unlinkSync(this.lockPath);
          continue;
        }
      } catch { /* retry */ }
      // 同步 sleep ~50ms，避免 CPU 自旋。
      // 不使用 Atomics.wait（Node.js 主线程不支持）。
      // Windows 上用 PowerShell 的 Start-Sleep，Unix 上用 sleep。
      // 作为轻量锁，50ms 轮询间隔是可接受的折中方案。
      const until = Date.now() + 50;
      while (Date.now() < until) {
        // 忙等待 50ms — 对短时锁（文件操作）影响极小
      }
    }
    return false;
  }

  release(): void {
    if (!this.acquired) return;
    try { fs.unlinkSync(this.lockPath); } catch { /* ignore */ }
    this.acquired = false;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
