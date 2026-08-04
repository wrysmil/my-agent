import { ipcMain } from "electron";

export function registerChatIpc(): void {
  // 占位实现 — 实际 streaming 由 Plan B 的 stream-chat feature 提供
  ipcMain.on("chat:stream", async (event, { streamId, message }) => {
    // Echo 占位：后续接入 AgentRunner 流式输出
    event.sender.send("stream:text_delta", {
      streamId,
      payload: { text: `Echo: ${message}` },
    });
    event.sender.send("stream:done", {
      streamId,
      payload: { sessionId: "placeholder" },
    });
  });

  // R6 修正: 统一为 ipcMain.handle 模式（与 api.js 的 invoke 一致）
  ipcMain.handle("chat:cancel", async (_event, streamId: string) => {
    // 后续接入 abortChat
    console.log("chat cancelled:", streamId);
    return { ok: true };
  });
}
