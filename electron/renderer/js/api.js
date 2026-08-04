// electron/renderer/js/api.js
const api = {
  // ============================================================
  // 会话
  // ============================================================
  sessions: {
    list: (opts) => window.myAgent.invoke("sessions:list", opts),
    get: (id) => window.myAgent.invoke("sessions:get", id),
    delete: (id) => window.myAgent.invoke("sessions:delete", id),
    rename: (id, name) => window.myAgent.invoke("sessions:rename", id, name),
    archive: (id) => window.myAgent.invoke("sessions:archive", id),
    unarchive: (id) => window.myAgent.invoke("sessions:unarchive", id),
  },

  // ============================================================
  // 对话（流式）
  // ============================================================
  chat: {
    send(input) {
      return window.myAgent.stream("chat:stream", input);
    },
    cancel(id) {
      return window.myAgent.invoke("chat:cancel", id);
    },
  },

  // ============================================================
  // 配置
  // ============================================================
  config: {
    get: () => window.myAgent.invoke("config:get"),
    update: (patch) => window.myAgent.invoke("config:update", patch),
  },

  // ============================================================
  // Skills
  // ============================================================
  skills: {
    list: () => window.myAgent.invoke("skills:list"),
    get: (id) => window.myAgent.invoke("skills:get", id),
    setEnabled: (id, enabled) =>
      window.myAgent.invoke("skills:setEnabled", id, enabled),
  },

  // ============================================================
  // Providers（模型厂商配置）
  // ============================================================
  providers: {
    list: () => window.myAgent.invoke("providers:list"),
    save: (input) => window.myAgent.invoke("providers:save", input),
    delete: (id) => window.myAgent.invoke("providers:delete", id),
    setEnabled: (id, enabled) =>
      window.myAgent.invoke("providers:setEnabled", id, enabled),
    test: (id) => window.myAgent.invoke("providers:test", id),
  },

  // ============================================================
  // 应用
  // ============================================================
  app: {
    getVersion: () => window.myAgent.invoke("app:getVersion"),
  },
};
