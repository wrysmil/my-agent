import * as path from "node:path";
import * as os from "node:os";

const ROOT = process.env.MY_AGENT_HOME
  ?? path.join(os.homedir(), ".my-agent");

export function rootDir(): string {
  return ROOT;
}

export function dataDir(): string {
  return path.join(ROOT, "data");
}

export function sessionsDir(): string {
  return path.join(dataDir(), "sessions");
}

export function sessionFile(sessionId: string): string {
  return path.join(sessionsDir(), `${sessionId}.jsonl`);
}

export function contextFile(sessionId: string): string {
  return path.join(sessionsDir(), `${sessionId}.context.json`);
}

export function skillsDir(): string {
  return path.join(dataDir(), "skills");
}

export function builtinSkillsDir(): string {
  return path.join(ROOT, "skills");
}

export function toolResultsDir(sessionId: string): string {
  return path.join(dataDir(), "tool-results", sessionId);
}

export function logsDir(): string {
  return path.join(dataDir(), "logs");
}

export function locksDir(): string {
  return path.join(dataDir(), "locks");
}

export function dbFile(): string {
  return path.join(dataDir(), "my-agent.db");
}
