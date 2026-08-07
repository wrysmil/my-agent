import { describe, it, expect } from "vitest";
import {
  actorSessionId,
  genWorkerId,
  buildGconvSessionId,
  buildGworkerSessionId,
  COMMANDER_ID,
  USER_ID,
} from "../../src/orchestration/actor.js";
import type { Actor } from "../../src/orchestration/actor.js";

describe("actor", () => {
  describe("buildGconvSessionId", () => {
    it("returns gconv- prefixed id", () => {
      expect(buildGconvSessionId("abc123")).toBe("gconv-abc123");
    });
  });

  describe("buildGworkerSessionId", () => {
    it("returns gworker-{cid}-{workerId} format", () => {
      expect(buildGworkerSessionId("abc123", "w001")).toBe("gworker-abc123-w001");
    });
  });

  describe("actorSessionId", () => {
    it("routes commander to gconv", () => {
      const actor: Actor = { kind: "commander", id: COMMANDER_ID };
      expect(actorSessionId("abc123", actor)).toBe("gconv-abc123");
    });

    it("routes worker to gworker", () => {
      const actor: Actor = { kind: "worker", id: "w001" };
      expect(actorSessionId("abc123", actor)).toBe("gworker-abc123-w001");
    });

    it("throws for agent kind", () => {
      const actor: Actor = { kind: "agent", id: "coder" };
      expect(() => actorSessionId("abc123", actor)).toThrow("has no session");
    });

    it("throws for user kind", () => {
      const actor: Actor = { kind: "user", id: USER_ID };
      expect(() => actorSessionId("abc123", actor)).toThrow("has no session");
    });
  });

  describe("genWorkerId", () => {
    it("generates unique ids", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(genWorkerId());
      }
      expect(ids.size).toBe(100);
    });

    it("starts with 'w'", () => {
      const id = genWorkerId();
      expect(id.startsWith("w")).toBe(true);
    });
  });
});
