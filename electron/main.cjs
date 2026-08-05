// CJS entry point for Electron — Electron's built-in 'electron' module is CJS-only
// and cannot be imported via ESM named exports in Node.js < 22 (Electron 33 bundles Node 20).
// This thin CJS wrapper loads electron, then uses dynamic import() for ESM app modules.
const { app, BrowserWindow } = require("electron");
const path = require("node:path");

let mainWindow = null;

// ------------------------------------------------------------
// Agent 初始化 — 创建 SessionStore、读取配置、构建 AgentRunner 工厂
//
// 返回 { store, createRunner } 供 initIpc 注入 registerChatIpc()；
// 失败（better-sqlite3 原生模块 ABI 不兼容）时返回 null，由 chat 默认实现兜底。
// ------------------------------------------------------------
async function initAgent() {
  try {
    const { SessionStore } = await import("../src/storage/session-store.js");
    const { readConfigFile } = await import("../src/storage/config-store.js");
    const { AgentRunner } = await import("../src/agent/runner.js");
    const { BUILTIN_TOOLS } = await import("../src/tools/builtin.js");
    // 模块加载时自动注册 deepseek provider factory（WU-1.1）
    const { registry } = await import("../src/providers/index.js");
    const { CoreAgentConfigSchema } = await import("../src/config/schema.js");

    const configPath = path.join(app.getPath("userData"), "config.json");
    const config = CoreAgentConfigSchema.parse(readConfigFile(configPath) ?? {});

    const store = new SessionStore();
    console.log("[main] Agent initialized (SessionStore + AgentRunner factory)");

    return {
      store,
      createRunner: (session) =>
        new AgentRunner({ config, providers: registry, tools: BUILTIN_TOOLS, session }),
    };
  } catch (err) {
    console.warn(
      "[main] Agent 初始化失败（better-sqlite3 native module needs Electron ABI rebuild）:",
      String(err),
    );
    return null;
  }
}

// ------------------------------------------------------------
// IPC 注册 — registerChatIpc() 注入 initAgent 的 store 与 createRunner
// （sessions/config/skills 无依赖，直接注册；不能走 index.ts 的 registerIpcHandlers，
//  因为其 registerChatIpc() 不接受 deps，会导致聊天走默认实现）
// ------------------------------------------------------------
async function initIpc(agent) {
  try {
    const { registerChatIpc } = await import("../src/ipc/chat.js");
    const { registerSessionsIpc } = await import("../src/ipc/sessions.js");
    const { registerConfigIpc } = await import("../src/ipc/config.js");
    const { registerSkillsIpc } = await import("../src/ipc/skills.js");
    const { closeDb } = await import("../src/storage/db.js");

    if (agent) {
      registerChatIpc({ store: agent.store, createRunner: agent.createRunner });
    } else {
      registerChatIpc();
    }
    registerSessionsIpc();
    registerConfigIpc();
    registerSkillsIpc();
    console.log("[main] IPC handlers registered");
    return closeDb;
  } catch (err) {
    console.warn(
      "[main] IPC handlers unavailable（better-sqlite3 native module needs Electron ABI rebuild）:",
      String(err),
    );
    return () => {};
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "My Agent",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(async () => {
  const agent = await initAgent();
  const closeDb = await initIpc(agent);
  createWindow();
  app.on("window-all-closed", () => {
    closeDb();
    app.quit();
  });
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
