# 执行日志：Session 持久化问题修复

**日期：** 2026-08-08
**问题：** 用户报告 session 没有持久化，聊天后刷新或切换页面会丢失历史记录
**状态：** ✅ 已修复

---

## 根因分析

**后端持久化完全正常。** 数据在磁盘 JSONL 文件里正确保存，`/api/sessions/:id/history` API 返回正确的消息数据。

真正的问题有多个层面：

### P0：前端反序列化失败（已在第一轮修复）
- 后端 `messageToSerialized()` 输出的 `content` 是 `[{type:"text", text:"..."}]` 数组格式
- 前端 `useChatStream.ts` 原本期望 `content` 是字符串，导致消息提取为空
- **修复：** 在 `useChatStream.ts` 添加 `Array.isArray(m.content)` 分支，从 content block 数组提取文本

### P0：侧边栏 Session 列表不刷新（本轮修复 — 核心问题）
- 用户创建 session 并发消息后，侧边栏的 session 列表**没有实时更新**
- `useSessions` 查询没有被 invalidate，react-query 缓存仍是旧数据
- 用户看左侧侧边栏找不到自己的 session → 以为"没保存"

### P1：config.json 模型列表错误（已在第一轮修复）
- `models.catalog` 中配置了 `deepseek-chat` 和 `deepseek-reasoner`，用户只配置了 `deepseek-v4-pro`
- **修复：** catalog 中只保留 `deepseek-v4-pro`

### P1：SettingsPage 硬编码模型列表（已在第一轮修复）
- 模型选择下拉框硬编码选项，不从 API 动态获取
- **修复：** 从 `/api/models` 获取可用模型列表

### P2：In-flight stream 冲突（已在第一轮修复）
- 同一 session 已有活跃 SSE 流时，新请求返回 409 错误
- **修复：** 自动取消旧流而不是返回 409

### P2：Composer 重复发送（已在第一轮修复）
- 添加 `sendingRef` 锁防止 500ms 内重复提交

---

## 本轮关键修复

### 1. ChatPage.tsx — Query Invalidation
```typescript
// 创建 session 后刷新侧边栏
queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
localStorage.setItem('my-agent.activeSession', data.session.id);

// 聊天完成后刷新侧边栏（更新 session 名称和消息数）
useEffect(() => {
  if (status === 'done' || status === 'error' || status === 'aborted') {
    queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
  }
}, [status, queryClient]);
```

### 2. useSessions.ts — 添加 staleTime
```typescript
staleTime: 10_000, // 10s 内视为新鲜，避免频繁请求；显式 invalidate 时强制刷新
```

### 3. TS 编译错误修复
- `useChatStream.ts`: 修复 SSE reader 类型（传 `res.body` 而非 `reader`）
- `useChatStream.ts`: 修复 `evt.data` 联合类型访问（添加类型断言）
- `app-shell.test.tsx`: 移除重复的 mock 属性 `Plus` 和 `Loader2`

---

## 验证结果

```
✅ 创建 session → 返回 201
✅ 发送消息 → SSE stream 正常
✅ 历史记录 API → 返回正确消息
✅ JSONL 文件 → 数据正确落盘
✅ Session 列表 → 包含新 session，名称和消息数正确
✅ 前端构建 → 无 TS 错误
✅ 服务器运行 → http://localhost:4321
```

---

## 涉及文件

| 文件 | 修改内容 |
|------|----------|
| `web/src/features/chat/useChatStream.ts` | Array.isArray 反序列化 + SSE reader 类型修复 |
| `web/src/pages/ChatPage.tsx` | Query invalidation + localStorage 活跃session |
| `web/src/features/sessions/useSessions.ts` | staleTime 优化 |
| `web/src/components/chat/Composer.tsx` | sendingRef 防重复发送 |
| `web/src/pages/SettingsPage.tsx` | 动态模型列表 |
| `config.json` | models.catalog 只保留 deepseek-v4-pro |
| `web/tests/unit/app-shell.test.tsx` | 移除重复 mock 属性 |
