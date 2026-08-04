// electron/renderer/modules/markdown.js
function renderMarkdown(text) {
  if (typeof marked === "undefined") {
    return escapeHtml(text).replace(/\n/g, "<br>");
  }
  return marked.parse(text, { breaks: true, gfm: true });
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
