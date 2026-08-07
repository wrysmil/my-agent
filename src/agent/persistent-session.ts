/**
 * PersistentSession — 持久化会话状态管理器
 *
 * 继承 Session，在每次消息/状态变更时自动将数据写入磁盘。
 *
 * 存储格式：
 * - 消息文件：`<sessionDir>/<sessionId>.jsonl` — JSONL 格式，每行一条消息
 * - 上下文侧车：`<sessionDir>/<sessionId>.context.json` — 结构化元数据
 *
 * 特性：
 * - 追加写入保证崩溃安全（JSONL 天然支持）
 * - 加载时自动修复中断的工具调用（孤儿 tool_use → 合成 tool_result）
 * - 上下文侧车 atomic 写入（tempfile + rename）
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { Mutex } from "async-mutex";
import { Session, estimateTextTokens } from "./session.js";
import type {
  CompletedWorkEntry,
  CompletedWorkInput,
  ExecutionPlanState,
  ExecutionPlanStepStatus,
  HistoryResource,
} from "./session.js";
import type { Message, MessageContent } from "../shared/types.js";
import {
  appendJsonLineAtomic,
  readJsonLines,
  writeJsonLines,
  atomicWrite,
  ensureDir,
  removeFile,
  defaultSessionDir,
} from "../storage/jsonl.js";
import { sessionFile, contextFile, sessionsDir, assertPathSegment } from "../storage/paths.js";
import type {
  SerializedMessage,
  SerializedSessionContext,
  SerializedTurn,
} from "./session-serde.js";
import {
  messageToSerialized,
  serializedToMessage,
  isValidSerializedMessage,
} from "./session-serde.js";
import { ApiError, ApiErrorCode } from "../web/server/errors.js";

// ============================================================
// 压缩契约（contract § B8）
// ============================================================

/**
 * 压缩估算（`POST /api/sessions/:cid/compact/preview` 响应体）。
 *
 * - `beforeTokens` —— 压缩前 session 内消息的估算 token 数
 * - `afterTokens`  —— 压缩后（被 summary 替换后）的估算 token 数
 * - `reductionPct` —— 节省百分比（0-100，0 表示无节省）
 *
 * **不修改 session 状态** —— 仅用于「先看效果再确认压缩」的前端交互。
 */
export type CompactEstimate = {
  beforeTokens: number;
  afterTokens: number;
  reductionPct: number;
};

/**
 * 压缩结果（`POST /api/sessions/:cid/compact` 响应体）。
 *
 * - `removedMessages`   —— 被替换掉的消息条数
 * - `summaryMessageId`  —— 新写入的 summary message id（客户端可借此跳到该消息）
 * - `beforeTokens`      —— 压缩前估算 token 数
 * - `afterTokens`       —— 压缩后估算 token 数
 * - `reductionPct`      —— 节省百分比
 */
export type CompactResult = {
  removedMessages: number;
  summaryMessageId: string | null;
  beforeTokens: number;
  afterTokens: number;
  reductionPct: number;
};

/**
 * PersistentSession.compactNow 的输入。
 *
 * `summary` 由 `AgentRunner.compactNow` 通过 provider 非流式 completion
 * 生成（受 `CONTEXT_COMPACTION_SYSTEM_PROMPT` 约束）。
 */
export type PersistentCompactInput = {
  summary: string;
};

// ============================================================
// 类型
// ============================================================

export type PersistentSessionOptions = {
  /** 会话唯一标识（不传则自动生成） */
  sessionId?: string;
  /** 存储目录（默认 ~/.my-agent/sessions/） */
  sessionDir?: string;
  /** 不存在时是否自动创建（默认 true） */
  createIfMissing?: boolean;
};

// ============================================================
// PersistentSession
// ============================================================

export class PersistentSession extends Session {
  readonly sessionId: string;
  private sessionFile: string;
  private contextFile: string;
  private _completedTurns: SerializedTurn[] = [];
  private _resources: HistoryResource[] = [];
  private _loading = false;

  /**
   * per-cid 串行化互斥锁（spec § 6.5 / R-22）。
   *
   * 用于防止同一 session 的并发压缩导致消息竞态：
   * - 第一个调用进入 `runExclusive`，拿到锁
   * - 后续调用通过 `isLocked()` 预检发现锁被占，立即抛 `CHAT_SESSION_BUSY`
   *
   ** 不用于 chat 流并发（chat 域的互斥在 messages.ts 单独管）。
   */
  readonly cidMutex: Mutex = new Mutex();

  constructor(opts: PersistentSessionOptions = {}) {
    super();

    this.sessionId = opts.sessionId ?? `session-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    // 统一兜底：无论是否自定义 sessionDir，sessionId 进 path.join 前必须过防御校验
    assertPathSegment(this.sessionId, "sessionId");

    const dir = opts.sessionDir ?? sessionsDir();
    ensureDir(dir);

    this.sessionFile = opts.sessionDir
      ? path.join(dir, `${this.sessionId}.jsonl`)
      : sessionFile(this.sessionId);

    this.contextFile = opts.sessionDir
      ? path.join(dir, `${this.sessionId}.context.json`)
      : contextFile(this.sessionId);

    const createIfMissing = opts.createIfMissing !== false;

    if (!fs.existsSync(this.sessionFile)) {
      if (createIfMissing) {
        fs.writeFileSync(this.sessionFile, "", { encoding: "utf-8" });
        this.writeContextToDisk();
      }
    } else {
      this._loading = true;
      this.loadFromDisk();
      this._loading = false;
    }
  }

  // ============================================================
  // 静态工厂
  // ============================================================

  static create(sessionDir?: string): PersistentSession {
    return new PersistentSession({ sessionDir, createIfMissing: true });
  }

  static load(
    sessionId: string,
    sessionDir?: string,
  ): PersistentSession | null {
    assertPathSegment(sessionId, "sessionId"); // 拼路径前防御
    const dir = sessionDir ?? defaultSessionDir();
    const file = path.join(dir, `${sessionId}.jsonl`);

    if (!fs.existsSync(file)) return null;

    return new PersistentSession({
      sessionId,
      sessionDir: dir,
      createIfMissing: false,
    });
  }

  static list(sessionDir?: string): string[] {
    const dir = sessionDir ?? defaultSessionDir();
    if (!fs.existsSync(dir)) return [];

    const ids = new Set<string>();
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      // 兼容存量 session- 前缀与 gconv/cli/anon/extract kind 前缀
      const match = entry.name.match(/^((?:session|gconv|cli|anon|extract)-[a-z0-9-]+)\.jsonl$/);
      if (match) ids.add(match[1]);
    }

    return Array.from(ids).sort();
  }

  // ============================================================
  // 磁盘操作
  // ============================================================

  private loadFromDisk(): void {
    // 1. 加载消息
    const serialized = readJsonLines<SerializedMessage>(
      this.sessionFile,
      (_line, _err, _idx) => {
        /* 损坏行静默跳过 */
      },
    );

    const rawMessages: Message[] = [];
    for (const sm of serialized) {
      if (!isValidSerializedMessage(sm)) continue;
      rawMessages.push(serializedToMessage(sm));
    }

    // 2. 修复孤儿工具调用
    const healed = this.healOrphanToolUses(rawMessages);

    // 3. 注入消息到父类
    for (const msg of healed) {
      this.injectMessage(msg);
    }

    // 4. 如果有修复，重写
    if (healed.length !== rawMessages.length) {
      this.flushMessagesToDisk(healed);
    }

    // 5. 加载上下文侧车
    this.loadContextFromDisk();
  }

  /**
   * 将消息注入到父类的内部消息数组（绕过磁盘写入）。
   *
   * 仅在 _loading=true 时使用，直接操作父类 protected 字段。
   */
  private injectMessage(msg: Message): void {
    // 直接操作父类的 protected 字段
    if (msg.turnId && msg.turnId > this.turnId) {
      this.turnId = msg.turnId;
    }
    this.messages.push(msg);
  }

  private flushMessagesToDisk(messages: readonly Message[]): void {
    const lines = messages.map((m) => messageToSerialized(m));
    writeJsonLines(this.sessionFile, lines);
  }

  private writeContextToDisk(): void {
    if (this._loading) return;

    const context: SerializedSessionContext = {
      version: 1,
      nextTurnId: this.turnId,
      completedTurns: this._completedTurns,
      resources: this._resources,
      executionPlan: this.getExecutionPlan(),
      completedWork: this.getCompletedWorkLedger(),
      nextWorkLedgerId: this.workEntryIdCounter,
    };

    atomicWrite(this.contextFile, JSON.stringify(context, null, 2));
  }

  private loadContextFromDisk(): void {
    if (!fs.existsSync(this.contextFile)) return;

    try {
      const raw = fs.readFileSync(this.contextFile, "utf-8");
      const ctx = JSON.parse(raw) as SerializedSessionContext;

      if (ctx.version !== 1) return;

      this.turnId = ctx.nextTurnId ?? 0;
      this._completedTurns = ctx.completedTurns ?? [];
      this._resources = ctx.resources ?? [];
      this.workEntryIdCounter = ctx.nextWorkLedgerId ?? 0;

      if (ctx.executionPlan) {
        this.restoreExecutionPlan(ctx.executionPlan);
      }

      if (ctx.completedWork) {
        this.restoreCompletedWork(ctx.completedWork);
      }
    } catch {
      this.rebuildTurnStateFromMessages();
    }
  }

  private rebuildTurnStateFromMessages(): void {
    let maxTurnId = 0;
    for (const msg of this.messages) {
      if (msg.turnId && msg.turnId > maxTurnId) {
        maxTurnId = msg.turnId;
      }
    }
    if (maxTurnId > 0) this.turnId = maxTurnId;
    this._completedTurns = [];
  }

  // ============================================================
  // Tool 协议修复
  // ============================================================

  private healOrphanToolUses(messages: Message[]): Message[] {
    const toolUseIds = new Set<string>();
    const toolResultIds = new Set<string>();

    for (const msg of messages) {
      for (const block of msg.content) {
        if (block.type === "tool_use") toolUseIds.add(block.id);
        if (block.type === "tool_result") toolResultIds.add(block.toolUseId);
      }
    }

    // 孤儿 tool_use：有调用无结果
    const orphans = new Set<string>();
    for (const id of toolUseIds) {
      if (!toolResultIds.has(id)) orphans.add(id);
    }

    if (orphans.size === 0) return messages;

    const healed: Message[] = [];
    for (const msg of messages) {
      healed.push(msg);

      for (const block of msg.content) {
        if (block.type === "tool_use" && orphans.has(block.id)) {
          healed.push({
            role: "user" as const,
            content: [
              {
                type: "tool_result" as const,
                toolUseId: block.id,
                content: `[interrupted: 工具 "${block.name}" 未完成执行（上次异常终止）]`,
                isError: true,
              },
            ],
            turnId: msg.turnId,
          });
        }
      }
    }

    return healed;
  }

  // ============================================================
  // 重写父类方法（自动落盘）
  // ============================================================

  /** @override */
  override async beginUserTurn(content: MessageContent[]): Promise<number> {
    const tid = await super.beginUserTurn(content);
    if (!this._loading) {
      const last = this.messages[this.messages.length - 1];
      await appendJsonLineAtomic<SerializedMessage>(
        this.sessionFile,
        messageToSerialized(last),
      );
      this.writeContextToDisk();
    }
    return tid;
  }

  /** @override */
  override async addAssistantMessage(content: MessageContent[]): Promise<void> {
    await super.addAssistantMessage(content);
    if (!this._loading) {
      const last = this.messages[this.messages.length - 1];
      await appendJsonLineAtomic<SerializedMessage>(
        this.sessionFile,
        messageToSerialized(last),
      );
    }
  }

  /** @override */
  override async addToolResult(
    toolUseId: string,
    content: string,
    isError?: boolean,
  ): Promise<void> {
    await super.addToolResult(toolUseId, content, isError);
    if (!this._loading) {
      const last = this.messages[this.messages.length - 1];
      await appendJsonLineAtomic<SerializedMessage>(
        this.sessionFile,
        messageToSerialized(last),
      );
    }
  }

  /** @override */
  override async addMessage(
    role: "user" | "assistant",
    content: MessageContent[],
  ): Promise<void> {
    await super.addMessage(role, content);
    if (!this._loading) {
      const last = this.messages[this.messages.length - 1];
      await appendJsonLineAtomic<SerializedMessage>(
        this.sessionFile,
        messageToSerialized(last),
      );
    }
  }

  /** @override */
  override completeActiveTurn(outcome?: string): void {
    if (this._loading) return;

    const tid = this.turnId;
    if (tid <= 0) return;

    const existing = this._completedTurns.find((t) => t.id === tid);

    if (existing) {
      existing.endIndex = this.messages.length;
      if (outcome) existing.outcome = outcome;
    } else {
      let userIdx = -1;
      let assistantIdx = -1;
      for (let i = this.messages.length - 1; i >= 0; i--) {
        const m = this.messages[i];
        if (m.turnId === tid) {
          if (m.role === "assistant" && assistantIdx < 0) assistantIdx = i;
          if (m.role === "user" && userIdx < 0) userIdx = i;
        }
      }

      this._completedTurns.push({
        id: tid,
        userMessageIndex: userIdx >= 0 ? userIdx : this.messages.length - 1,
        finalAssistantMessageIndex:
          assistantIdx >= 0 ? assistantIdx : this.messages.length - 1,
        startIndex: userIdx >= 0 ? userIdx : this.messages.length - 1,
        endIndex: this.messages.length,
        archived: false,
        outcome,
      });
    }

    this.writeContextToDisk();
  }

  /** @override */
  override updateExecutionPlan(
    update: {
      steps?: Array<{ step: string; status: ExecutionPlanStepStatus }>;
    },
  ): ExecutionPlanState {
    const plan = super.updateExecutionPlan(update);
    this.writeContextToDisk();
    return plan;
  }

  /** @override */
  override clearExecutionPlan(): void {
    super.clearExecutionPlan();
    this.writeContextToDisk();
  }

  /** @override */
  override recordCompletedWork(
    input: CompletedWorkInput,
  ): CompletedWorkEntry | undefined {
    const entry = super.recordCompletedWork(input);
    this.writeContextToDisk();
    return entry;
  }

  /** @override */
  override addHistoryResource(
    resource: HistoryResource & { sourceTurnId?: number },
  ): void {
    super.addHistoryResource(resource);
    if (!this._resources.some((r) => r.path === resource.path)) {
      this._resources.push(resource as HistoryResource);
    }
    this.writeContextToDisk();
  }

  /** @override */
  override getSessionId(): string {
    return this.sessionId;
  }

  // ============================================================
  // 压缩（contract § B8）—— WU-06a
  // ============================================================

  /**
   * 估算压缩效果（不动 session 状态）。
   *
   * `beforeTokens` 直接调用父类 `estimateModelTokens()`；
   * `afterTokens` 用 `summaryMaxTokens`（典型一次压缩后 summary 文本的
   * token 上限，与 runner `TOOL_LOOP_LIMIT_SUMMARY_MAX_TOKENS` 同源）
   * —— 仅是预览，不发起任何 provider 调用。
   *
   * `reductionPct` 是整数百分比（0-100）。
   *
   * **不修改 session 状态**，因此不需要 mutex。可重复调用。
   */
  async compactPreview(): Promise<CompactEstimate> {
    const beforeTokens = this.estimateModelTokens();
    // 估算压缩后 token 数：典型 summary 上限 1200。
    const summaryMaxTokens = 1200;
    const afterTokens = beforeTokens > 0
      ? Math.min(beforeTokens, summaryMaxTokens)
      : 0;
    const reductionPct = beforeTokens > 0
      ? Math.round(((beforeTokens - afterTokens) / beforeTokens) * 100)
      : 0;
    return { beforeTokens, afterTokens, reductionPct };
  }

  /**
   * 实际压缩（替换全部 messages 为单条 summary message）。
   *
   * **mutex 行为：**
   * - 预检 `cidMutex.isLocked()` → 已锁定则立即抛 `CHAT_SESSION_BUSY`
   * - 进入 `runExclusive` 串行执行：避免两个并发 compact 把 messages
   *   列表竞争到不一致（spec § 6.5 R-22 race）
   *
   * **磁盘行为：**
   * - `flushMessagesToDisk` 重写整个 JSONL 为新内容（单条 summary）
   * - 上下文侧车不变（plan / ledger / turn 与压缩无关）
   *
   * @returns `{ removedMessages, summaryMessageId, afterTokens }`
   *   `beforeTokens` / `reductionPct` 由调用方（AgentRunner）从
   *   `compactPreview()` 合并；本方法只关心替换后的状态。
   */
  async compactNow(
    opts: PersistentCompactInput,
  ): Promise<Omit<CompactResult, "beforeTokens" | "reductionPct">> {
    if (this.cidMutex.isLocked()) {
      throw new ApiError(
        ApiErrorCode.CHAT_SESSION_BUSY,
        `Another compact operation is already in progress for session "${this.sessionId}"`,
      );
    }
    return this.cidMutex.runExclusive(async () => {
      const removedMessages = this.messages.length;

      // 生成稳定 summary message id（前端可借此滚动到该消息）
      const summaryMessageId = `msg-${randomUUID().replace(/-/g, "").slice(0, 12)}`;

      const summaryMessage: Message = {
        role: "assistant",
        content: [{ type: "text", text: opts.summary }],
        turnId: this.turnId,
      };

      // 替换 messages：原列表清空 + push 单条 summary
      this.messages.length = 0;
      this.messages.push(summaryMessage);

      // 落盘（重写整个 JSONL 文件）
      this.flushMessagesToDisk(this.messages);

      const afterTokens = estimateTextTokens(opts.summary);
      return { removedMessages, summaryMessageId, afterTokens };
    });
  }

  // ============================================================
  // 生命周期
  // ============================================================

  close(): void {
    this.writeContextToDisk();
  }

  delete(): void {
    this.close();
    removeFile(this.sessionFile);
    removeFile(this.contextFile);
  }

  /**
   * 获取会话名称（基于首条用户消息的摘要）。
   */
  getDisplayName(): string {
    for (const msg of this.messages) {
      if (msg.role === "user") {
        for (const block of msg.content) {
          if (block.type === "text") {
            const text = block.text.trim();
            return text.length > 40 ? text.slice(0, 40) + "..." : text;
          }
        }
      }
    }
    return this.sessionId;
  }

  // ============================================================
  // 内部辅助
  // ============================================================

  private restoreExecutionPlan(plan: ExecutionPlanState): void {
    this.ensureExecutionPlanAnchor();
    this.updateExecutionPlan({
      steps: plan.steps.map((s) => ({ step: s.step, status: s.status })),
    });
  }

  private restoreCompletedWork(work: CompletedWorkEntry[]): void {
    for (const entry of work) {
      super.recordCompletedWork({
        toolCallId: entry.toolCallId,
        tool: entry.tool,
        inputDigest: entry.inputDigest,
        inputSummary: entry.inputSummary,
        status: entry.status,
        resultRef: entry.resultRef,
        resultSummary: entry.resultSummary,
        checkpointEpoch: entry.checkpointEpoch,
      });
    }
  }
}
