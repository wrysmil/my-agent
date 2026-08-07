/**
 * icons.js — SVG 图标系统
 *
 * 所有图标集中管理，禁止在其他模块中硬编码 SVG 路径或使用 emoji 作为图标。
 * 挂载到 window: uiIconHtml(name, className?) / fileIconHtml(filename)
 */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;

  // ============================================================
  // 文件扩展名分类
  // ============================================================
  const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'ico']);
  const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv', 'avi', 'mkv']);
  const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'opus']);
  const CODE_EXTS = new Set([
    'py', 'ts', 'tsx', 'js', 'jsx', 'html', 'css', 'scss', 'less',
    'sh', 'bash', 'zsh', 'rb', 'go', 'rs', 'java', 'kt', 'kts',
    'c', 'cpp', 'h', 'hpp', 'sql', 'graphql', 'vue', 'svelte',
  ]);
  const DATA_EXTS = new Set(['json', 'yaml', 'yml', 'toml', 'csv', 'xml', 'ini', 'cfg']);
  const TEXT_EXTS = new Set(['txt', 'md', 'mdx', 'rst', 'log']);
  const SPREADSHEET_EXTS = new Set(['xlsx', 'xlsm', 'xls', 'csv', 'tsv']);
  const PRESENTATION_EXTS = new Set(['pptx', 'pptm', 'ppt']);
  const ARCHIVE_EXTS = new Set(['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar']);

  // ============================================================
  // 统一图标渲染
  // ============================================================
  function wrapUiIcon(name, inner, className) {
    var cls = (className || 'ui-icon') + ' is-' + name;
    return '<svg class="' + cls + '" viewBox="0 0 24 24" width="16" height="16"'
      + ' fill="none" stroke="currentColor" stroke-width="1.9"'
      + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + inner + '</svg>';
  }

  // ============================================================
  // UI 图标字典（本项目必需的 ~30 个，按字母序）
  // ============================================================
  var UI_ICONS = {
    'alert-circle': '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>',
    'archive': '<path d="M21 8v13H3V8"></path><path d="M1 3h22v5H1z"></path><path d="M10 12h4"></path>',
    'calendar': '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>',
    'check': '<polyline points="20 6 9 17 4 12"></polyline>',
    'chevron-down': '<polyline points="6 9 12 15 18 9"></polyline>',
    'chevron-right': '<polyline points="9 18 15 12 9 6"></polyline>',
    'chevron-up': '<polyline points="18 15 12 9 6 15"></polyline>',
    'clock': '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>',
    'copy': '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>',
    'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>',
    'edit': '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>',
    'external-link': '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line>',
    'file': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline>',
    'folder': '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>',
    'globe': '<circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>',
    'info': '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>',
    'list': '<line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line>',
    'message-square': '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>',
    'moon': '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>',
    'paperclip': '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>',
    'plus': '<line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>',
    'puzzle': '<path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.611a2.404 2.404 0 0 1-3.404 0l-1.563-1.563a1.026 1.026 0 0 0-.881-.289c-.328.052-.661-.054-.896-.289L3.706 16.44a2.404 2.404 0 0 1 0-3.404l1.563-1.563a1.026 1.026 0 0 0 .289-.881.99.99 0 0 0-.282-.909L3.706 8.116a2.404 2.404 0 0 1 0-3.404l1.567-1.567A2.404 2.404 0 0 1 8.682 3.15l1.563 1.563c.236.23.576.339.896.289.326-.05.655.057.881.289l1.567 1.567a2.404 2.404 0 0 1 0 3.404l-1.563 1.563a1.026 1.026 0 0 0-.289.881.99.99 0 0 0 .282.909l1.567 1.567a.98.98 0 0 1 .276.837z"></path>',
    'search': '<circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>',
    'send': '<line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>',
    'settings': '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>',
    'slash': '<circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>',
    'sparkles': '<path d="M12 3l1.4 3.6L17 8l-3.6 1.4L12 13l-1.4-3.6L7 8l3.6-1.4z"></path><path d="M18 15l.7 1.8 2 .3-1.5 1.3.4 2-1.6-.9-1.6.9.4-2-1.5-1.3 2-.3z"></path>',
    'stop-circle': '<circle cx="12" cy="12" r="10"></circle><rect x="9" y="9" width="6" height="6" rx="1"></rect>',
    'sun': '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>',
    'terminal': '<polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line>',
    'trash': '<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>',
    'upload': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line>',
    'user': '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>',
    'users': '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><path d="M20 21v-2a4 4 0 0 0-4-4h-1"></path><circle cx="18" cy="4" r="3"></circle>',
    'x': '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>',
  };

  // 文件类型图标
  var FILE_KIND_ICONS = {
    image: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline>',
    video: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><polygon points="10 8 16 12 10 16 10 8"></polygon>',
    audio: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><path d="M9 17V8l7-3v12"></path><circle cx="7" cy="17" r="1.5"></circle><circle cx="16" cy="17" r="1.5"></circle>',
    code: '<polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline>',
    data: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="8" y1="8" x2="16" y2="8"></line><line x1="8" y1="12" x2="16" y2="12"></line><line x1="8" y1="16" x2="12" y2="16"></line>',
    text: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="8" y1="8" x2="16" y2="8"></line><line x1="8" y1="12" x2="16" y2="12"></line><line x1="8" y1="16" x2="12" y2="16"></line>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline>',
    spreadsheet: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line><line x1="9" y1="3" x2="9" y2="21"></line>',
    presentation: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><polyline points="3 9 12 3 21 9"></polyline><line x1="12" y1="3" x2="12" y2="14"></line>',
    archive: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="3" x2="9" y2="21"></line>',
  };

  // ============================================================
  // 文件类型分类
  // ============================================================
  function _fileKindIconClass(filename) {
    var ext = (filename || '').split('.').pop().toLowerCase();
    if (IMAGE_EXTS.has(ext)) return 'image';
    if (VIDEO_EXTS.has(ext)) return 'video';
    if (AUDIO_EXTS.has(ext)) return 'audio';
    if (SPREADSHEET_EXTS.has(ext)) return 'spreadsheet';
    if (PRESENTATION_EXTS.has(ext)) return 'presentation';
    if (ARCHIVE_EXTS.has(ext)) return 'archive';
    if (CODE_EXTS.has(ext)) return 'code';
    if (DATA_EXTS.has(ext)) return 'data';
    if (TEXT_EXTS.has(ext)) return 'text';
    return 'file';
  }

  // ============================================================
  // 对外 API
  // ============================================================
  root.uiIconHtml = function (name, className) {
    var inner = UI_ICONS[name];
    if (!inner) {
      // 未知图标返回空，不在 console 刷警告
      return '';
    }
    return wrapUiIcon(name, inner, className);
  };

  root.fileIconHtml = function (filename) {
    var kind = _fileKindIconClass(filename);
    var inner = FILE_KIND_ICONS[kind] || FILE_KIND_ICONS.file;
    return '<svg class="chat-file-kind-icon is-' + kind + '" viewBox="0 0 24 24"'
      + ' width="16" height="16" fill="none" stroke="currentColor"'
      + ' stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"'
      + ' aria-hidden="true">' + inner + '</svg>';
  };

  // 暴露图标名列表供其他模块查询
  root.uiIconNames = Object.keys(UI_ICONS);
})();
