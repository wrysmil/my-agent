import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadAgentSpec } from "../../src/orchestration/agent-spec.js";
import { _resetDataRoot } from "../../src/storage/paths.js";

describe("agent-spec", () => {
  const tmpDir = path.join(os.tmpdir(), `my-agent-test-${Date.now()}`);
  const agentsDir = path.join(tmpDir, "agents");

  beforeEach(() => {
    process.env.MY_AGENT_HOME = tmpDir;
    _resetDataRoot();
    fs.mkdirSync(agentsDir, { recursive: true });
  });

  afterEach(() => {
    delete process.env.MY_AGENT_HOME;
    _resetDataRoot();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("loadAgentSpec", () => {
    it("loads a valid agent.json", async () => {
      const agentDir = path.join(agentsDir, "coder");
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(
        path.join(agentDir, "agent.json"),
        JSON.stringify({
          agent_id: "coder",
          name: "Code Assistant",
          description_zh: "代码助手",
          workflow: "You are a code specialist.",
          skill_list: ["bash", "read_file"],
        }),
      );

      const spec = await loadAgentSpec("coder");
      expect(spec).not.toBeNull();
      expect(spec!.agent_id).toBe("coder");
      expect(spec!.name).toBe("Code Assistant");
      expect(spec!.description_zh).toBe("代码助手");
      expect(spec!.workflow).toBe("You are a code specialist.");
      expect(spec!.skill_list).toEqual(["bash", "read_file"]);
    });

    it("returns null for non-existent agent", async () => {
      const spec = await loadAgentSpec("nonexistent");
      expect(spec).toBeNull();
    });

    it("falls back name to agentId", async () => {
      const agentDir = path.join(agentsDir, "minimal");
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(
        path.join(agentDir, "agent.json"),
        JSON.stringify({ agent_id: "minimal" }),
      );

      const spec = await loadAgentSpec("minimal");
      expect(spec!.name).toBe("minimal");
    });

    it("throws on agent_id mismatch", async () => {
      const agentDir = path.join(agentsDir, "mismatch");
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(
        path.join(agentDir, "agent.json"),
        JSON.stringify({ agent_id: "wrong", name: "Wrong" }),
      );

      await expect(loadAgentSpec("mismatch")).rejects.toThrow("agent_id mismatch");
    });

    it("rejects path traversal in agentId", async () => {
      await expect(loadAgentSpec("../etc")).rejects.toThrow();
      await expect(loadAgentSpec("a/b")).rejects.toThrow();
    });
  });
});
