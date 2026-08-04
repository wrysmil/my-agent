import { app, BrowserWindow } from "electron";
import * as path from "node:path";
import { registerIpcHandlers } from "../src/ipc/index.js";
import { closeDb } from "../src/storage/db.js";

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "My Agent",
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,        // false: 允许预加载脚本访问 fs（用于 devtools）
    },
  });

  mainWindow.loadFile(path.join(import.meta.dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
});

app.on("window-all-closed", () => {
  closeDb();
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
