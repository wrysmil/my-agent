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

  // 流式取消：preload stream.cancel() 通过 send 发送 chat:stream:cancel
  ipcMain.on("chat:stream:cancel", (_event, { streamId }) => {
    // 后续接入 abortChat
    console.log("chat stream cancelled:", streamId);
  });

  // 直接取消（通过 api.chat.cancel(id) invoke 调用）
  ipcMain.handle("chat:cancel", async (_event, streamId: string) => {
    console.log("chat cancelled:", streamId);
    return { ok: true };
  });
}
