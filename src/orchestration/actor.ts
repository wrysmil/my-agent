// ---- Actor 类型 ----
export type ActorKind = "commander" | "user" | "agent" | "worker";

export interface Actor {
  kind: ActorKind;
  id: string;
  name?: string;
}

export const COMMANDER_ID = "commander";
export const USER_ID = "user";

// ---- Session ID builder ----
/** 主会话（commander） */
export function buildGconvSessionId(cid: string): string {
  return `gconv-${cid}`;
}

/** 匿名 worker 会话 */
export function buildGworkerSessionId(cid: string, workerId: string): string {
  return `gworker-${cid}-${workerId}`;
}

/** 按 Actor 路由到对应 session id */
export function actorSessionId(cid: string, actor: Actor): string {
  if (actor.kind === "commander") return buildGconvSessionId(cid);
  if (actor.kind === "worker") return buildGworkerSessionId(cid, actor.id);
  // agent kind 保留给 S2
  throw new Error(`actor ${actor.kind}/${actor.id} has no session`);
}

// ---- 辅助 ----
let _workerSeq = 0;
/** 生成短 worker id（6 位 hex + 递增序号，保证同毫秒不碰撞） */
export function genWorkerId(): string {
  const ts = Date.now().toString(36).slice(-4);
  const seq = (++_workerSeq).toString(36);
  return `w${ts}${seq}`;
}
