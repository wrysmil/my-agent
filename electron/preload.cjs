// electron/preload.js
// ⚠️ 必须是 .js（不跑 tsx hook），electron/package.json 设置 type:commonjs 确保 CJS 加载
// 命名空间：window.myAgent（非 window.orkas — 这是 MyAgent 项目）

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("myAgent", {
  // 请求-响应（invoke/handle 模式）
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),

  // 流式通道（用于 Agent SSE 输出 + 工具执行事件）
  stream: (channel, payload) => {
    const streamId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    ipcRenderer.send(channel, { streamId, ...payload });

    return {
      on: (event, callback) => {
        const listener = (_ev, data) => {
          if (data.streamId === streamId) callback(data.payload);
        };
        ipcRenderer.on(`stream:${event}`, listener);
        return () =>
          ipcRenderer.removeListener(`stream:${event}`, listener);
      },
      cancel: () => {
        ipcRenderer.send(`${channel}:cancel`, { streamId });
      },
    };
  },

  // 主进程 → Renderer 的事件推送
  on: (channel, callback) => {
    const listener = (_ev, ...args) => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
