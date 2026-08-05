// electron/renderer/modules/markdown.js

/** 允许的 HTML 标签白名单 */
const ALLOWED_TAGS = new Set([
  "p", "pre", "code", "ul", "ol", "li", "strong", "em", "b", "i",
  "a", "img", "table", "thead", "tbody", "tr", "th", "td",
  "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "hr", "br",
  "span", "div", "del", "ins", "sup", "sub", "dl", "dt", "dd",
]);

/** 允许的属性（按标签） */
const ALLOWED_ATTRS = {
  a: new Set(["href", "title"]),
  img: new Set(["src", "alt", "title", "width", "height"]),
  th: new Set(["align"]),
  td: new Set(["align"]),
  code: new Set(["class"]),
  pre: new Set(["class"]),
  span: new Set(["class"]),
  div: new Set(["class"]),
};

/**
 * 基于 DOM 的 HTML 消毒器。
 * 移除不在白名单内的标签，以及允许标签上的危险属性。
 * 同时过滤 javascript: / data: 等危险协议。
 */
function sanitizeHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = html;

  const walk = (node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = node.tagName.toLowerCase();

      // 移除不在白名单内的元素（保留其子节点）
      if (!ALLOWED_TAGS.has(tag)) {
        while (node.firstChild) {
          node.parentNode.insertBefore(node.firstChild, node);
        }
        node.parentNode.removeChild(node);
        return;
      }

      // 移除危险属性
      const allowedAttrs = ALLOWED_ATTRS[tag] || new Set();
      const attrsToRemove = [];
      for (const attr of node.attributes) {
        const name = attr.name.toLowerCase();
        // 移除所有事件处理器和不在白名单内的属性
        if (name.startsWith("on") || !allowedAttrs.has(name)) {
          attrsToRemove.push(name);
        }
        // 检查危险协议
        if ((name === "href" || name === "src") && typeof attr.value === "string") {
          const v = attr.value.trim().toLowerCase();
          if (v.startsWith("javascript:") || v.startsWith("data:text/html")) {
            attrsToRemove.push(name);
          }
        }
      }
      for (const name of attrsToRemove) {
        node.removeAttribute(name);
      }
    }

    // 递归处理子节点（使用静态快照，因为 DOM 可能在遍历中被修改）
    let child = node.firstChild;
    while (child) {
      const next = child.nextSibling;
      walk(child);
      child = next;
    }
  };

  walk(template.content);
  return template.innerHTML;
}

function renderMarkdown(text) {
  if (typeof marked === "undefined") {
    return escapeHtml(text).replace(/\n/g, "<br>");
  }
  const raw = marked.parse(text, { breaks: true, gfm: true });
  return sanitizeHtml(raw);
}

function escapeHtml(str) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return str.replace(/[&<>"']/g, (c) => map[c]);
}
