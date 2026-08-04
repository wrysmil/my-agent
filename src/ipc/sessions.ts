import { ipcMain } from "electron";
import * as repo from "../storage/session-repo.js";

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
