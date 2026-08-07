// src/renderer/js/ipc/ipc-shim.js — IPC 路由垫片（阶段2）
// 统一 IPC 调用入口。依赖：preload.cjs 中的 window.myAgent。
//
// payload 约定（与主进程 ipc handler 实参形状对齐，避免破坏既有功能）：
//   * 单参 handler（sessions:get/delete/archive/unarchive、skills:get、
//     providers:delete/test、chat:cancel）—— 直接传原始标量（与旧 api.js 一致）；
//   * 多参 handler（sessions:rename、skills:setEnabled、providers:setEnabled）
//     —— 以单对象 {id, ...} 传递（新 invoke 为单 payload，主进程需解构，待 main 侧跟进）。
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;

  // stream 事件类型常量
  const SE = {
    TEXT_DELTA: 'text_delta',
    TOOL_START: 'tool_start',
    TOOL_END: 'tool_end',
    RETRY: 'retry',
    DONE: 'done',
    ERROR: 'error'
  };

  const IPC = {
    // ============================================================
    // Agent（阶段4 启用，当前预留）
    // ============================================================
    agents: {
      list: function () { return root.myAgent.invoke('agents:list'); },
      get: function (id) { return root.myAgent.invoke('agents:get', id); },
      create: function (data) { return root.myAgent.invoke('agents:create', data); },
      update: function (id, data) { return root.myAgent.invoke('agents:update', Object.assign({ id: id }, data)); },
      delete: function (id) { return root.myAgent.invoke('agents:delete', id); }
    },

    // ============================================================
    // 会话
    // ============================================================
    sessions: {
      list: function (opts) { return root.myAgent.invoke('sessions:list', opts); },
      get: function (id) { return root.myAgent.invoke('sessions:get', id); },
      delete: function (id) { return root.myAgent.invoke('sessions:delete', id); },
      rename: function (id, name) { return root.myAgent.invoke('sessions:rename', { id: id, name: name }); },
      archive: function (id) { return root.myAgent.invoke('sessions:archive', id); },
      unarchive: function (id) { return root.myAgent.invoke('sessions:unarchive', id); }
    },

    // ============================================================
    // 聊天（流式 — 新协议）
    // ============================================================
    chat: {
      /**
       * 发送聊天消息（流式）
       * @param {string} sessionId
       * @param {string} text
       * @param {function} onEvent — (ev) => void，其中 ev.type 为 text_delta/tool_start/tool_end/retry
       * @returns {{ promise: Promise, cancel: function }}
       */
      send: function (sessionId, text, onEvent) {
        return root.myAgent.stream('chat:send', { sessionId: sessionId, text: text }, onEvent);
      },
      cancel: function (sessionId) {
        return root.myAgent.invoke('chat:cancel', sessionId);
      }
    },

    // ============================================================
    // 配置
    // ============================================================
    config: {
      get: function () { return root.myAgent.invoke('config:get'); },
      update: function (patch) { return root.myAgent.invoke('config:update', patch); }
    },

    // ============================================================
    // Skills
    // ============================================================
    skills: {
      list: function () { return root.myAgent.invoke('skills:list'); },
      get: function (id) { return root.myAgent.invoke('skills:get', id); },
      setEnabled: function (id, enabled) { return root.myAgent.invoke('skills:setEnabled', { id: id, enabled: enabled }); }
    },

    // ============================================================
    // Providers
    // ============================================================
    providers: {
      list: function () { return root.myAgent.invoke('providers:list'); },
      save: function (data) { return root.myAgent.invoke('providers:save', data); },
      delete: function (id) { return root.myAgent.invoke('providers:delete', id); },
      setEnabled: function (id, enabled) { return root.myAgent.invoke('providers:setEnabled', { id: id, enabled: enabled }); },
      test: function (id) { return root.myAgent.invoke('providers:test', id); }
    },

    // ============================================================
    // 应用
    // ============================================================
    app: {
      getVersion: function () { return root.myAgent.invoke('app:getVersion'); }
    }
  };

  root.IPC = IPC;
  root.STREAM_EVENTS = SE;
})();
