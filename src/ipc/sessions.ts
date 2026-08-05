import { ipcMain } from "electron";
import * as path from "node:path";
import * as repo from "../storage/session-repo.js";
import { SessionStore } from "../storage/session-store.js";
import { defaultSessionDir, readJsonLines } from "../storage/jsonl.js";
import type { SerializedMessage } from "../agent/session-serde.js";
import { isValidSerializedMessage } from "../agent/session-serde.js";

// 模块级 SessionStore 单例（与 chat.ts 的 getDefaultStore 同目录：~/.my-agent/sessions）
let _store: SessionStore | undefined;
function getStore(): SessionStore {
  if (!_store) _store = new SessionStore();
  return _store;
}

export function registerSessionsIpc(): void {
  ipcMain.handle("sessions:list", async (_e, opts?: {
    search?: string;
    offset?: number;
    limit?: number;
  }) => {
    const sessions = repo.listSessions(opts);
    const total = repo.countSessions({ search: opts?.search });
    return { sessions, total };
  });

  ipcMain.handle("sessions:get", async (_e, id: string) => {
    return repo.getSession(id) ?? null;
  });

  // 读取会话消息历史（JSONL → SerializedMessage[]，含 role/content/turnId/ts）。
  // 使用 SessionStore 加载 PersistentSession 以校验会话存在性；
  // 消息体从 JSONL 读取，保留 ts 时间戳（内存 Message 不含 ts）。
  // 会话不存在 / 加载失败 / 文件损坏 → 返回空数组 []，不抛错。
  ipcMain.handle("sessions:getMessages", async (_e, id: string) => {
    try {
      if (!id) return [];
      const session = getStore().get(id);
      if (!session) return [];
      const sessionFile = path.join(defaultSessionDir(), `${id}.jsonl`);
      const serialized = readJsonLines<SerializedMessage>(
        sessionFile,
        () => {
          /* 损坏行静默跳过 */
        },
      );
      return serialized.filter(isValidSerializedMessage);
    } catch {
      return [];
    }
  });

  ipcMain.handle("sessions:delete", async (_e, id: string) => {
    repo.deleteSession(id);
    return { ok: true };
  });

  ipcMain.handle("sessions:rename", async (_e, id: string, name: string) => {
    repo.renameSession(id, name);
    return { ok: true };
  });

  ipcMain.handle("sessions:archive", async (_e, id: string) => {
    repo.archiveSession(id);
    return { ok: true };
  });

  ipcMain.handle("sessions:unarchive", async (_e, id: string) => {
    repo.unarchiveSession(id);
    return { ok: true };
  });
}
