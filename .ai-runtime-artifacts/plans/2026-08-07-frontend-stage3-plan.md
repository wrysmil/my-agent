---
artifact: implementation-plan
route: writing-plans
skills:
  - writing-plans
skills_evidence:
  - skipped: writing-plans (not found on this platform)
dispatch: .ai-runtime-artifacts/plans/2026-08-07-frontend-stage3-dispatch.md
source:
  - .ai-runtime-artifacts/specs/2026-08-07-frontend-implementation-all-stages.md § 第三阶段
  - AGENTS.md
  - harness-kit/core/routing.md
  - harness-kit/project.profile.md
created_at: 2026-08-07
status: draft
approved: false
---

# 阶段3：UI 组件体系 — 实现计划

> **For agentic workers:** 本计划含 3 个 WU，GROUP-1（1 WU 基础组件）+ GROUP-2（2 并行 WU 集成替换）。

**Goal:** 建立可复用的 UI 组件层（对话框/侧边栏拖拽/右键菜单/动态表单），替代现有页面中浏览器原生 `confirm()`/`alert()`/`prompt()` 调用，增强交互体验。

**Architecture:** 四个独立 IIFE 模块文件，通过全局作用域暴露 API（`uiChoice`/`uiConfirm`/`uiAlert`/`initSidebarResize`/`showContextMenu`/`renderChatForm`），由现有 features 模块按需调用。

**Tech Stack:** 纯 JS IIFE（`<script>` 标签加载）+ CSS 变量 + DOM API。

---

## 一、项目现状摸底

### 1.1 需要替换的原生调用

通过 Grep 扫描 `src/renderer/`，共有 **7 处** 需要替换：

| 文件 | 行号 | 当前调用 | 场景 |
|---|---|---|---|
| `sessions.js` | 212 | `confirm("确定删除 N 个会话？...")` | 批量删除确认 |
| `sessions.js` | 230 | `confirm("确定归档选中的 N 个会话？")` | 批量归档确认 |
| `sessions.js` | 276 | `alert("导出失败：...")` | 导出失败提示 |
| `sessions.js` | 294 | `confirm("选择操作:\n确定=删除, 取消=重命名")` | 行操作菜单（原生 confirm hack） |
| `sessions.js` | 300 | `prompt("新名称:")` | 重命名输入 |
| `sessions.js` | 308 | `confirm("确定删除此会话？")` | 单条删除确认 |
| `settings.js` | 288 | `confirm("确定删除此 Provider？")` | Provider 删除确认 |
| `settings.js` | 687 | `confirm("恢复默认设置？")` | 恢复默认确认 |

### 1.2 阶段3 依赖的已完成模块

| 模块 | 文件 | 状态 |
|---|---|---|
| 图标系统 | `src/renderer/js/shared/icons.js` | ✅ 阶段1 已完成 |
| 国际化 i18n | `src/renderer/js/shared/i18n.js` | ✅ 阶段1 已完成 |
| 安全工具 | `src/renderer/js/shared/utils.js`（`escapeHtml`） | ✅ 阶段1 已完成 |
| IPC 层 | `src/renderer/js/ipc/ipc-shim.js` | ✅ 阶段2 已完成 |
| 全局状态 | `src/renderer/js/state/state.js` | ✅ 阶段1 已完成 |

### 1.3 涉及文件

| 文件 | 操作 | 当前行数(估) | 说明 |
|---|---|---|---|
| `src/renderer/js/components/dialogs.js` | 新建 | — | 对话框系统（uiChoice/uiConfirm/uiAlert） |
| `src/renderer/js/components/sidebar.js` | 新建 | — | 侧边栏拖拽调整宽度 |
| `src/renderer/js/components/context-menu.js` | 新建 | — | 自定义右键菜单 |
| `src/renderer/js/components/chat-input-form.js` | 新建 | — | 动态表单渲染（阶段5 接入用框架） |
| `src/renderer/locales/zh.json` | 修改 | 59 | 新增 ~15 个 i18n key |
| `src/renderer/style.css` | 修改 | ~1200 | 新增 ~100 行组件样式 |
| `src/renderer/index.html` | 修改 | ~200 | 新增 4 个 `<script>` 标签 |
| `src/renderer/js/features/sessions.js` | 修改 | ~330 | 替换 confirm/alert/prompt → uiConfirm/uiAlert/右键菜单 |
| `src/renderer/js/features/settings.js` | 修改 | ~750 | 替换 2 处 confirm → uiConfirm |
| `src/renderer/js/features/chat.js` | 修改 | ~700 | 会话列表右键菜单（重命名/删除） |
| `src/renderer/js/app.js` | 修改 | 117 | 侧边栏拖拽初始化 + 右键菜单全局监听 |

---

## 二、Task 拆解

### Task 3.1：对话框系统

**产出：** `src/renderer/js/components/dialogs.js`（新建，~120 行）

**WU：** GROUP-1 WU-01

**核心 API：**

```js
// 多选对话框（底层原语）
async function uiChoice({ title, message, choices, cancelLabel, highlight }) → Promise<string|null>

// 确认框（二选一，基于 uiChoice）
async function uiConfirm({ title, message, confirmLabel, cancelLabel, danger }) → Promise<boolean>

// 提示框（单按钮，基于 uiChoice）
async function uiAlert({ title, message }) → Promise<void>
```

**实现要点：**

1. **Overlay + 对话框 DOM：** 
   - 创建半透明遮罩 `z-index: 1000`
   - 对话框居中，`max-width: 420px`，圆角 + 阴影
   - header（标题 + 可选关闭按钮）/ body（消息文本，`escapeHtml` 转义）/ footer（按钮组）
   
2. **按钮样式：**
   - `highlight` 参数指定高亮按钮 id（如 `'confirm'`）→ `btn-primary`；其余 `btn-ghost`
   - `danger: true` → 高亮按钮变红色 `btn-danger`
   
3. **键盘操作：**
   - `Enter` → 触发高亮按钮（或第一个 choice）
   - `Escape` → 触发 cancel（resolve null）
   
4. **关闭清理：**
   - `_closeDialog()` 函数：remove overlay + removeEventListener
   - 防止内存泄漏

5. **样式：** 新增 `.dialog-overlay` / `.dialog` / `.dialog-header` / `.dialog-body` / `.dialog-footer` CSS 类

**验收：**
- `await uiConfirm({ title: '测试', message: '确认操作？' })` → 点击确定返回 `true`
- `await uiAlert({ title: '提示', message: '操作成功' })` → 点击确定返回 `undefined`
- Escape 键关闭对话框，返回 `null`/`false`

---

### Task 3.2：侧边栏增强

**产出：** `src/renderer/js/components/sidebar.js`（新建，~100 行）

**WU：** GROUP-1 WU-01

**核心 API：**

```js
function initSidebarResize(opts) → void
  // opts: { sidebarSelector, handleSelector, minWidth, maxWidth, defaultWidth, storageKey }
```

**实现要点：**

1. **Resize handle：** 在 `#session-panel` 右边缘创建 4px 宽的不可见拖拽手柄（或复用现有 border）
   - 实际做法：监听 `#session-panel` 的右边缘 mousedown → 进入拖拽模式

2. **拖拽逻辑：**
   - `mousedown` on handle → 记录起始 X + 起始宽度
   - `document.addEventListener('mousemove', onDrag)` — 更新 `--sidebar-width` CSS 变量
   - `document.addEventListener('mouseup', onDrop)` — 持久化宽度到 localStorage
   - 拖拽时添加 `body { cursor: col-resize; user-select: none; }` 防止文本选中

3. **双击重置：**
   - 双击 handle → 恢复 `--sidebar-width` 到默认 260px，更新 localStorage

4. **边界约束：**
   - `minWidth: 180`，`maxWidth: 480`，拖拽超出时 clamp

5. **CSS 变量联动：**
   ```css
   :root { --sidebar-width: 260px; }
   #session-panel { width: var(--sidebar-width); }
   #main { margin-left: calc(48px + var(--sidebar-width)); }
   ```

**验收：**
- 拖拽会话面板右边缘能调整宽度，实时跟随鼠标
- 双击边缘恢复默认宽度 260px
- 刷新页面后宽度保持（localStorage 持久化）
- 宽度不会超出 180–480 范围

---

### Task 3.3：右键菜单

**产出：** `src/renderer/js/components/context-menu.js`（新建，~80 行）

**WU：** GROUP-1 WU-01

**核心 API：**

```js
function showContextMenu(items, x, y) → Promise<string|null>
  // items: [{ id, label, icon?, danger?, separator? }]
  // 返回被选中的 item id，或 null（取消）
```

**实现要点：**

1. **菜单 DOM：**
   - 绝对定位 `position: fixed; z-index: 1100`
   - 每个 item 为一行：`<div class="context-menu-item">`，含图标（可选）+ 文字
   - `danger: true` → 红色文字
   - `separator: true` → 分割线（不响应点击）

2. **位置计算（防溢出）：**
   - 获取菜单宽高 → 如果 `x + width > window.innerWidth` → `x = window.innerWidth - width - 8`
   - 如果 `y + height > window.innerHeight` → `y = window.innerHeight - height - 8`
   - 至少保留 8px 边距

3. **关闭逻辑：**
   - 点击菜单项 → resolve(item.id) → 移除菜单
   - 点击菜单外部 → resolve(null) → 移除菜单
   - Escape 键 → resolve(null) → 移除菜单
   - 滚轮 → resolve(null) → 移除菜单（防止菜单位置错位）

4. **样式：**
   ```css
   .context-menu { min-width: 160px; background: var(--bg-main); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.12); padding: 4px 0; }
   .context-menu-item { padding: 6px 12px; cursor: pointer; font-size: 13px; }
   .context-menu-item:hover { background: var(--bg-hover); }
   .context-menu-item.is-danger { color: #e74c3c; }
   .context-menu-separator { height: 1px; background: var(--border); margin: 4px 0; }
   ```

**验收：**
- `showContextMenu([{id:'a',label:'选项A'},{id:'b',label:'选项B',danger:true}], 100, 100)` → 菜单出现在 (100,100)
- 点击选项返回对应 id，点击外部返回 null
- 菜单靠近视口边缘时自动调整位置不溢出

---

### Task 3.4：动态表单渲染

**产出：** `src/renderer/js/components/chat-input-form.js`（新建，~100 行）

**WU：** GROUP-1 WU-01

**核心 API：**

```js
function renderChatForm(container, payload, onSubmit) → { destroy: () => void }
  // payload: { formId, title, fields: [{ name, type, label, required, options?, placeholder? }] }
  // 返回 destroy 函数用于清理
```

**实现要点：**

1. **字段类型支持：**
   - `text` / `number` → `<input type="text|number">`
   - `textarea` → `<textarea>`
   - `select` → `<select>` + `<option>` 列表
   - `checkbox` → `<input type="checkbox">` + label
   - `radio` → 一组 `<input type="radio">`

2. **渲染位置：** 在聊天气泡内渲染（非弹窗），替换容器内容

3. **提交逻辑：**
   - 收集表单数据 → `onSubmit(formData)` 
   - 表单保持显示（不自动清除），由调用方决定何时 `destroy()`

4. **草稿保留：**
   ```js
   var _formDrafts = new Map(); // key = `${sessionId}::${formId}`
   ```
   - 切换会话时保存草稿，切回时恢复
   - 阶段3 仅搭框架（Map + get/set/del 函数），阶段5 接入

5. **样式：**
   ```css
   .chat-form { padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-secondary); }
   .chat-form-title { font-weight: 600; margin-bottom: 8px; }
   .chat-form-field { margin-bottom: 8px; }
   .chat-form-label { display: block; font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; }
   .chat-form-submit { margin-top: 12px; }
   ```

**验收：**
- `renderChatForm(el, {formId:'t1', title:'测试',fields:[{name:'x',type:'text',label:'X'}]}, console.log)` → 渲染表单
- 填写并提交 → `onSubmit({x: '...'})` 被调用
- 返回的 `destroy()` 函数能清除表单 DOM

---

### Task 3.5：集成 — sessions.js 改造

**产出：** 修改 `src/renderer/js/features/sessions.js`（~30 行改动）

**WU：** GROUP-2 WU-02

**依赖：** GROUP-1（dialogs.js + context-menu.js 已就绪）

**改动清单：**

| 行号 | 当前代码 | 目标代码 |
|---|---|---|
| 212 | `confirm("确定删除 N 个会话？...")` | `await uiConfirm({ title: t('sessions.delete'), message: t('sessions.delete_batch_confirm', {count: this.selected.size}), danger: true })` |
| 230 | `confirm("确定归档选中的 N 个会话？")` | `await uiConfirm({ title: t('sessions.archive'), message: t('sessions.archive_batch_confirm', {count: this.selected.size}) })` |
| 276 | `alert("导出失败：...")` | `await uiAlert({ title: t('sessions.export'), message: t('sessions.export_fail') })` |
| 293-304 | `showRowMenu()` 用 `confirm`/`prompt` | 改为调用 `showContextMenu([...], x, y)` → 根据返回 id 走对应逻辑 |
| 308 | `confirm("确定删除此会话？")` | `await uiConfirm({ title: t('sessions.delete'), message: t('sessions.delete_single_confirm'), danger: true })` |

**新增 i18n key（加入 zh.json）：**
```json
"sessions.delete_batch_confirm": "确定删除 {{count}} 个会话？此操作不可撤销。",
"sessions.archive_batch_confirm": "确定归档选中的 {{count}} 个会话？",
"sessions.delete_single_confirm": "确定删除此会话？此操作不可撤销。",
"sessions.rename": "重命名",
"sessions.export_fail": "导出龙败：没有可导出的会话数据。",
"sessions.context_rename": "重命名",
"sessions.context_delete": "删除",
"sessions.context_export": "导出"
```

**右键菜单集成：** `showRowMenu(id, anchor)` 改为异步 `showContextMenu` 调用：
```js
async showRowMenu(id, anchor) {
  var action = await showContextMenu([
    { id: 'rename', label: t('sessions.context_rename') },
    { id: 'export', label: t('sessions.context_export') },
    { id: 'delete', label: t('sessions.context_delete'), danger: true },
  ], anchor.clientX, anchor.clientY);
  
  if (action === 'rename') {
    // TODO: 用内联编辑替代 prompt（阶段3 简化：仍用 prompt 做输入，后续阶段4 换内联编辑）
    var name = prompt(t('sessions.rename') + ':');
    if (name) { await api.sessions.rename(id, name); await this.load(); }
  } else if (action === 'export') {
    this.selected.clear(); this.selected.add(id);
    await this.batchExport();
  } else if (action === 'delete') {
    await this.deleteSingle(id);
  }
}
```

**验收：**
- 批量删除 → 弹出自定义确认框（标题+消息+确定/取消按钮），点确定执行删除
- 会话行右键 → 弹出菜单（重命名/导出/删除），选"删除"弹出确认框
- 导出失败 → 弹出提示框而非浏览器 alert

---

### Task 3.6：集成 — settings.js + chat.js + app.js 改造

**产出：** 修改 3 个文件（~60 行改动）

**WU：** GROUP-2 WU-03

**依赖：** GROUP-1（dialogs.js + sidebar.js + context-menu.js 已就绪）

#### 3.6.1 settings.js（2 处 confirm 替换）

| 行号 | 当前代码 | 目标代码 |
|---|---|---|
| 288 | `confirm("确定删除此 Provider？")` | `await uiConfirm({ title: t('settings.providers'), message: t('settings.delete_provider_confirm'), danger: true })` |
| 687 | `confirm("恢复默认设置？")` | `await uiConfirm({ title: t('settings.title'), message: t('settings.reset_confirm'), danger: true })` |

**新增 i18n key：**
```json
"settings.delete_provider_confirm": "确定删除此 Provider？",
"settings.reset_confirm": "恢复默认设置？此操作不可撤销。"
```

#### 3.6.2 chat.js（会话列表右键菜单）

在 `renderSessionList()` 中给每个会话列表项绑定 `contextmenu` 事件：

```js
// 在 renderSessionList 中，给每个 .session-item 添加右键监听
item.addEventListener('contextmenu', function(e) {
  e.preventDefault();
  SessionsPage.showRowMenu(session.id, e);
});
```

注意：chat.js 的会话列表和 sessions.js 共用 `SessionsPage.showRowMenu()`，菜单逻辑集中在 sessions.js。

#### 3.6.3 app.js（侧边栏初始化 + 右键菜单全局清理）

在 `App.init()` 末尾添加：

```js
// ── Stage 3: 初始化侧边栏拖拽 ──
if (typeof initSidebarResize === 'function') {
  initSidebarResize({
    sidebarSelector: '#session-panel',
    handleSelector: '#session-panel-resize-handle',
    minWidth: 180,
    maxWidth: 480,
    defaultWidth: 260,
    storageKey: 'myagent:sidebarWidth',
  });
}
```

**HTML 补充：** 在 `index.html` 的 `#session-panel` 内添加一个 resize handle 元素：
```html
<div id="session-panel-resize-handle" class="resize-handle"></div>
```

**CSS 补充：**
```css
.resize-handle { position: absolute; top: 0; right: 0; width: 4px; height: 100%; cursor: col-resize; z-index: 10; }
.resize-handle:hover, .resize-handle:active { background: var(--color-primary); opacity: 0.3; }
```

**验收：**
- settings.js 中删除 Provider / 恢复默认 → 弹出自定义确认框
- chat.js 的会话列表项右键 → 弹出上下文菜单
- 侧边栏可拖拽调整宽度

---

## 三、依赖图

```
┌──────────────────────────────────────────────────────┐
│ GROUP-1 (1 WU, 基础组件)                              │
│ WU-01: 4 个新组件文件 + CSS + i18n + HTML script 标签  │
│ Files: dialogs.js, sidebar.js, context-menu.js,       │
│        chat-input-form.js, zh.json, style.css,        │
│        index.html                                     │
└────────────────────────┬─────────────────────────────┘
                         │ GROUP-1 完成
                         ▼
          ┌──────────────────────────────┐
          │ GROUP-2 (并行, 2 WU)          │
          │                              │
          │ WU-02: sessions.js 集成      │
          │ WU-03: settings + chat + app │
          └──────────────┬───────────────┘
                         │
                         ▼
                 阶段3 完成
```

---

## 四、文件不相交验证

| 文件 | WU-01 | WU-02 | WU-03 |
|---|---|---|---|
| `js/components/dialogs.js` | ✅ 新建 | — | — |
| `js/components/sidebar.js` | ✅ 新建 | — | — |
| `js/components/context-menu.js` | ✅ 新建 | — | — |
| `js/components/chat-input-form.js` | ✅ 新建 | — | — |
| `locales/zh.json` | ✅ 修改 | — | — |
| `style.css` | ✅ 修改 | — | — |
| `index.html` | ✅ 修改 | — | — |
| `js/features/sessions.js` | — | ✅ 修改 | — |
| `js/features/settings.js` | — | — | ✅ 修改 |
| `js/features/chat.js` | — | — | ✅ 修改 |
| `js/app.js` | — | — | ✅ 修改 |

**GROUP-2 内 WU-02 与 WU-03 文件完全不相交，可安全并行。**

---

## 五、验证计划

### 5.1 自动化检查

- [ ] 4 个新组件文件无语法错误（Electron 加载不报错）
- [ ] `zh.json` 为合法 JSON
- [ ] `style.css` 无语法问题
- [ ] `index.html` `<script>` 标签顺序正确（components 在 features 之前）

### 5.2 手动验证（Electron 中）

- [ ] **对话框：** 删除会话 → 弹出自定义确认框（非浏览器 confirm），点取消不执行删除
- [ ] **对话框键盘：** 确认框中 Enter 确认 / Escape 取消
- [ ] **侧边栏：** 拖拽会话面板右边缘 → 宽度变化，刷新后保持
- [ ] **侧边栏双击：** 双击边缘 → 恢复 260px 默认宽度
- [ ] **右键菜单：** 会话列表项右键 → 弹出菜单（重命名/导出/删除）
- [ ] **右键菜单关闭：** 点击外部 / Escape / 滚轮 → 菜单消失
- [ ] **Provider 删除：** Settings → 删除 Provider → 确认框（带 danger 样式）

### 5.3 回归验证

- [ ] 4 个页面正常导航
- [ ] 聊天发送/接收正常
- [ ] 会话管理 CRUD 正常
- [ ] Settings 各 tab 切换正常
- [ ] 无 console 错误

---

## 六、Plan 自检

- [ ] 每个 Task 产出文件明确，无模糊描述
- [ ] GROUP-1（WU-01）为独立基础组件，GROUP-2 并行无文件冲突
- [ ] WU-02 和 WU-03 文件完全不相交，可安全并行
- [ ] 验收标准可操作（含具体调用方式）
- [ ] 现有功能全部保持可用（仅替换 confirm/alert 调用方式）
- [ ] i18n key 都在 zh.json 中定义（含 dialog 已有 key）
- [ ] 预估代码量 ~400 行（4 组件 ~400 行 + 集成改动 ~90 行 + i18n ~15 行 + CSS ~100 行）

---

## Next

**（写入后须暂停 — 即使用户句末含「然后执行」）**

- 计划确认 → 说「开始实现」或「执行」
- 需要调整 → 直接说修改意见
- 并行派发 → 确认后走 `orchestration` → `2026-08-07-frontend-stage3-dispatch.md`
