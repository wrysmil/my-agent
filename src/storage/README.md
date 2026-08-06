# Storage 模块

my-agent 持久化基础设施层。所有磁盘 I/O 的入口。

## 文件职责

| 文件 | 职责 | 行数 |
|---|---|---|
| `paths.ts` | 所有路径常量的唯一权威来源 | ~100 |
| `path-sandbox.ts` | 工具层运行时路径白名单门控 | ~60 |
| `jsonl.ts` | JSON/JSONL 原子读写 + 并发安全追加 | ~250 |
| `locks.ts` | session/file 粒度的 async-mutex 原语 | ~50 |
| `session-store.ts` | Session 生命周期管理 + kind 路由 + GC | ~200 |
| `providers-store.ts` | Provider 配置持久化（Zod 校验 + 损坏恢复） | ~180 |

## 使用约定

1. 所有路径先查 `paths.ts`，禁止散落 `path.join(__dirname, '..', 'data')`
2. JSON 文件改写必须走 `atomicWrite`（tempfile + rename）
3. 多上下文并发写同一 JSONL 文件必须用 `appendJsonLineAtomic`
4. 文件编辑操作先 `fileEditLock(absPath).acquire()`
5. 新增持久化"表"请遵循 owner 模式：模块暴露 `getXxx/setXxx/listXxx` 高层 API

## 路径布局

```text
~/.my-agent/                    # MY_AGENT_HOME
├── providers.json              # provider 配置
├── config.json                 # 全局配置（预留）
├── sessions/                   # 会话持久化
│   ├── gconv-<12hex>.jsonl    # 可恢复主对话
│   ├── gconv-<12hex>.context.json
│   ├── cli-<12hex>.jsonl      # 可恢复CLI会话
│   ├── anon-<12hex>.jsonl     # 短暂匿名会话（7天GC）
│   └── extract-<12hex>.jsonl  # 短暂提取会话（7天GC）
├── logs/                       # 日志（预留）
└── tmp/                        # 临时文件（预留）
```

## 并发模型约束

- 本阶段锁（`async-mutex`）为**进程内锁**。未来若前端为独立进程走 HTTP 服务，需保持「服务进程是唯一写者」架构；多进程写同一 JSONL 需重新评估。
- `appendJsonLineAtomic` 返回的 `msgIndex` 为 1-based 行号，可作审计 / 索引定位。
