// src/renderer/js/ipc/api.js — 向后兼容层（阶段2）
// 委托到 IPC（ipc-shim.js），保持现有 chat.js / sessions.js / skills.js / settings.js 的 api.* 调用不变。
// 注意：chat.send 的旧签名 { message, sessionId } 映射到新 IPC.chat.send(sessionId, text, onEvent)。
// 事件处理器经 input._onEvent 传递（由调用方设置；chat.js 已直接改用 IPC.chat.send，此兼容层供其他调用方保留旧签名）。
const api = {
  sessions: IPC.sessions,

  chat: {
    // 兼容旧接口：api.chat.send({ message, sessionId })
    send: function (input) {
      // 内部 _onEvent 字段由调用方设置（适配新协议）
      var onEvent = input._onEvent || function () {};
      return IPC.chat.send(input.sessionId, input.message, onEvent);
    },
    cancel: function (id) {
      return IPC.chat.cancel(id);
    }
  },

  config: IPC.config,
  skills: IPC.skills,
  providers: IPC.providers,
  app: IPC.app
};
