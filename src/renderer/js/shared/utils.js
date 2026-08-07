/**
 * utils.js — 安全工具函数
 *
 * XSS 防护第一道防线 + URI 白名单 + 国际化辅助。
 * 挂载到 window: escapeHtml / safeHref / pickLocalizedField / normalizeDisplayText
 */
(function () {
  var root = typeof window !== 'undefined' ? window : globalThis;

  // ============================================================
  // XSS 防护
  // ============================================================

  /**
   * HTML 实体转义 — 所有用户/模型生成的文本在插入 DOM 前必须经过此函数。
   */
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ============================================================
  // URI 安全
  // ============================================================

  /**
   * 安全 URI 白名单正则。
   * 允许: https? / mailto / tel / 应用特权 scheme (chat-media/chat-app/kb-file) / blob / 相对路径
   */
  var _SAFE_URI_RE = /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|chat-media|chat-app|kb-file|blob):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

  /**
   * 校验 href 是否安全。不安全返回空字符串。
   */
  function safeHref(url) {
    if (!url) return '';
    return _SAFE_URI_RE.test(String(url)) ? String(url) : '';
  }

  // ============================================================
  // 国际化辅助
  // ============================================================

  /**
   * 按语言链选择双语字段。
   * 示例: pickLocalizedField(agent, 'description', 'zh') →
   *   尝试 description_zh → description_en → description → ''
   */
  function pickLocalizedField(obj, base, lang, fallbackLang) {
    if (!obj || !base) return '';
    fallbackLang = fallbackLang || 'en';
    var cur = (lang || '').split(/[-_]/)[0] || 'zh';
    var candidates = [base + '_' + cur, base + '_' + fallbackLang, base + '_en', base + '_zh', base];
    var seen = {};
    for (var i = 0; i < candidates.length; i++) {
      var key = candidates[i];
      if (seen[key]) continue;
      seen[key] = true;
      var v = obj[key];
      if (v !== null && v !== undefined && String(v).trim()) {
        return normalizeDisplayText(v);
      }
    }
    return '';
  }

  /**
   * 清理多余空格、反转义弯引号。
   */
  function normalizeDisplayText(value) {
    if (!value && value !== 0) return '';
    return String(value)
      .replace(/\s+/g, ' ')
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .trim();
  }

  // ============================================================
  // ID 生成
  // ============================================================

  /**
   * 生成简短随机 ID。
   */
  function generateId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  // ============================================================
  // 对外 API
  // ============================================================
  root.escapeHtml = escapeHtml;
  root.safeHref = safeHref;
  root.pickLocalizedField = pickLocalizedField;
  root.normalizeDisplayText = normalizeDisplayText;
  root.generateId = generateId;
})();
