import { ipcMain } from "electron";

// 占位实现 — 实际 Skill 数据由 Plan C 的 skill-service 提供
export function registerSkillsIpc(): void {
  ipcMain.handle("skills:list", async () => {
    return [];
  });

  ipcMain.handle("skills:get", async (_e, _id: string) => {
    return null;
  });

  ipcMain.handle("skills:setEnabled", async (_e, _id: string, _enabled: boolean) => {
    return { ok: true };
  });
}
