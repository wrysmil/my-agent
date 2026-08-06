import { describe, it, expect } from "vitest";
import {
  isEphemeralSession,
  sessionKindOf,
  memoryScopeForSession,
} from "../../src/storage/session-store.js";

describe("sessionKindOf", () => {
  it("gconv-xxx → gconv", () => {
    expect(sessionKindOf("gconv-a1b2c3d4e5f6")).toBe("gconv");
  });

  it("cli-xxx → cli", () => {
    expect(sessionKindOf("cli-1234567890ab")).toBe("cli");
  });

  it("anon-xxx → anon", () => {
    expect(sessionKindOf("anon-fixed123456")).toBe("anon");
  });

  it("未知 kind 抛出", () => {
    expect(() => sessionKindOf("badkind-123456789012")).toThrow("session id");
  });

  it("无连字符抛出", () => {
    expect(() => sessionKindOf("nohyphen")).toThrow("session id");
  });
});

describe("isEphemeralSession", () => {
  it("anon → true", () => {
    expect(isEphemeralSession("anon-anything")).toBe(true);
  });

  it("extract → true", () => {
    expect(isEphemeralSession("extract-img-001")).toBe(true);
  });

  it("gconv → false", () => {
    expect(isEphemeralSession("gconv-my-chat")).toBe(false);
  });

  it("cli → false", () => {
    expect(isEphemeralSession("cli-run-001")).toBe(false);
  });
});

describe("memoryScopeForSession", () => {
  it("gconv → commander", () => {
    expect(memoryScopeForSession("gconv-abc")).toBe("commander");
  });

  it("anon → null", () => {
    expect(memoryScopeForSession("anon-abc")).toBeNull();
  });

  it("extract → null", () => {
    expect(memoryScopeForSession("extract-abc")).toBeNull();
  });
});
