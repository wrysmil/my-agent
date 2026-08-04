import { createRequire } from "node:module";
import * as fs from "node:fs";
import { dataDir, dbFile } from "./paths.js";

const require = createRequire(import.meta.url);

let _db: any = null;
let _DatabaseClass: any = undefined;

function getDatabaseClass(): any {
  if (_DatabaseClass !== undefined) return _DatabaseClass;
  try {
    _DatabaseClass = require("better-sqlite3");
  } catch (err) {
    _DatabaseClass = null;
    throw new Error(
      `better-sqlite3 native module not available: ${String(err)}. ` +
      "Run 'npx @electron/rebuild -w better-sqlite3' with Node >= 22."
    );
  }
  return _DatabaseClass;
}

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      -- ============================================================
      -- sessions — 会话元数据（摘要信息，不含消息内容）
      -- 对应 session-repo.ts 的 SessionMeta 接口
      -- ============================================================
      CREATE TABLE IF NOT EXISTS sessions (
        id              TEXT PRIMARY KEY,                               -- 会话唯一标识 (UUID)
        name            TEXT NOT NULL DEFAULT '',                       -- 会话名称（首条消息摘要或手动命名）
        model           TEXT NOT NULL DEFAULT '',                       -- 使用的模型 ID（如 deepseek-chat）
        provider        TEXT NOT NULL DEFAULT '',                       -- Provider 标识（anthropic/openai/deepseek/...）
        message_count   INTEGER NOT NULL DEFAULT 0,                    -- 消息总数（user + assistant + tool）
        input_tokens    INTEGER NOT NULL DEFAULT 0,                    -- 累计输入 token（从 usage_logs 聚合）
        output_tokens   INTEGER NOT NULL DEFAULT 0,                    -- 累计输出 token（从 usage_logs 聚合）
        created_at      INTEGER NOT NULL,                              -- 创建时间 (Unix ms)
        updated_at      INTEGER NOT NULL,                              -- 最后活跃时间 (Unix ms)
        is_archived     INTEGER NOT NULL DEFAULT 0                     -- 是否归档：0=活跃, 1=已归档（软删除）
      );

      -- ============================================================
      -- configs — 应用配置键值存储
      -- key 为配置路径，value 为 JSON 字符串
      -- ============================================================
      CREATE TABLE IF NOT EXISTS configs (
        key             TEXT PRIMARY KEY,                               -- 配置键（如 agent.defaultModel）
        value           TEXT NOT NULL,                                  -- 配置值（JSON 字符串）
        updated_at      INTEGER NOT NULL                                -- 最后更新时间 (Unix ms)
      );

      -- ============================================================
      -- usage_logs — 每次 LLM 调用的用量明细
      -- 用于用量统计、成本分析、图表展示
      -- ============================================================
      CREATE TABLE IF NOT EXISTS usage_logs (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,              -- 自增主键
        session_id      TEXT NOT NULL,                                  -- 所属会话 ID → sessions.id
        model           TEXT NOT NULL,                                  -- 实际使用的模型 ID
        provider        TEXT NOT NULL,                                  -- 实际调用的 Provider
        input_tokens    INTEGER NOT NULL DEFAULT 0,                    -- 输入 token 数（含 system prompt + 历史消息）
        output_tokens   INTEGER NOT NULL DEFAULT 0,                    -- 输出 token 数（模型生成的文本）
        cache_read_tokens   INTEGER NOT NULL DEFAULT 0,                -- 缓存命中读取 token 数（Anthropic prompt caching）
        cache_write_tokens  INTEGER NOT NULL DEFAULT 0,                -- 缓存写入 token 数
        tool_loops      INTEGER NOT NULL DEFAULT 0,                    -- 本轮执行了几轮工具调用
        duration_ms     INTEGER NOT NULL DEFAULT 0,                    -- 本轮耗时（毫秒，从首请求到最终响应）
        created_at      INTEGER NOT NULL,                              -- 调用时间 (Unix ms)
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_usage_session ON usage_logs(session_id);
      CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_logs(created_at);

      -- ============================================================
      -- skills_index — Skill 注册索引
      -- 记录每个 Skill 的元数据和启用状态。Skill 正文存储在磁盘 SKILL.md
      -- ============================================================
      CREATE TABLE IF NOT EXISTS skills_index (
        id              TEXT PRIMARY KEY,                               -- Skill 唯一标识（目录名）
        name            TEXT NOT NULL,                                  -- Skill 名称（human-readable）
        description_zh  TEXT NOT NULL DEFAULT '',                       -- 中文描述
        description_en  TEXT NOT NULL DEFAULT '',                       -- 英文描述
        source          TEXT NOT NULL DEFAULT 'user',                   -- 来源：user=用户安装, system=内置, marketplace=市场
        dir             TEXT NOT NULL,                                  -- Skill 所在目录的绝对路径
        enabled         INTEGER NOT NULL DEFAULT 1,                    -- 启用状态：1=启用, 0=禁用
        installed_at    INTEGER NOT NULL,                              -- 安装/首次发现时间 (Unix ms)
        updated_at      INTEGER NOT NULL                               -- 最后更新时间 (Unix ms)
      );

      -- ============================================================
      -- providers — LLM 厂商配置
      -- 存储 API Key（AES-256-GCM 加密）、Base URL、模型列表、优先级
      -- 对应 provider-repo.ts 的 ProviderEntry 接口
      -- ============================================================
      CREATE TABLE IF NOT EXISTS providers (
        id              TEXT PRIMARY KEY,                               -- Provider 唯一标识（如 deepseek-<timestamp>）
        name            TEXT NOT NULL,                                  -- 用户自定义显示名称（如 "我的 DeepSeek"）
        provider        TEXT NOT NULL,                                  -- 厂商标识：anthropic/openai/deepseek/moonshot/doubao
        api_key_enc     TEXT NOT NULL DEFAULT '',                       -- AES-256-GCM 加密后的 API Key（格式: iv:tag:ciphertext）
        base_url        TEXT NOT NULL DEFAULT '',                       -- API Base URL（空则使用 SDK 默认地址）
        models          TEXT NOT NULL DEFAULT '[]',                     -- 模型 ID 列表（JSON 数组，如 ["deepseek-chat","deepseek-reasoner"]）
        is_enabled      INTEGER NOT NULL DEFAULT 1,                    -- 启用状态：1=启用, 0=禁用
        priority        INTEGER NOT NULL DEFAULT 0,                    -- 优先级（越小越优先，0=主 Provider，用于故障转移排序）
        created_at      INTEGER NOT NULL,                              -- 创建时间 (Unix ms)
        updated_at      INTEGER NOT NULL                               -- 最后更新时间 (Unix ms)
      );

      -- ============================================================
      -- schema_version — 数据库迁移版本追踪
      -- 单行表，记录当前已应用的最新 migration version
      -- ============================================================
      CREATE TABLE IF NOT EXISTS schema_version (
        version         INTEGER PRIMARY KEY                            -- 已应用的最新迁移版本号
      );
    `,
  },
];

function migrate(db: any): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)"
  );
  const row = db
    .prepare("SELECT MAX(version) as v FROM schema_version")
    .get() as { v: number | null };
  const current = row?.v ?? 0;

  for (const m of MIGRATIONS) {
    if (m.version > current) {
      db.exec(m.sql);
      db.prepare(
        "INSERT OR REPLACE INTO schema_version (version) VALUES (?)"
      ).run(m.version);
    }
  }
}

export function getDb(): any {
  if (_db) return _db;
  const Database = getDatabaseClass();
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  _db = new Database(dbFile());
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  migrate(_db);
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
