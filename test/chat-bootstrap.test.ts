import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { bootstrapChat } from "../chat.js";

let tmpDir: string;
let providersPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-bootstrap-"));
  providersPath = path.join(tmpDir, "providers.json");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("bootstrapChat", () => {
  it("creates default providers.json when missing", async () => {
    const cli = {
      consoleLog: vi.fn(),
      consoleError: vi.fn(),
      exit: vi.fn(),
    };
    await bootstrapChat({
      argv: [],
      env: {},
      providersPath,
      cli,
      projectConfig: { agent: { systemPrompt: "test" } } as any,
    });
    expect(fs.existsSync(providersPath)).toBe(true);
  });

  it("returns the active provider config for downstream use", async () => {
    const cli = {
      consoleLog: vi.fn(),
      consoleError: vi.fn(),
      exit: vi.fn(),
    };
    const result = await bootstrapChat({
      argv: [],
      env: {},
      providersPath,
      cli,
      projectConfig: { agent: { systemPrompt: "test" } } as any,
    });
    expect(result.activeProvider?.id).toBe("deepseek");
  });
});
