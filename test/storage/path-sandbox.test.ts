import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { isPathAllowed, guardPath } from "../../src/storage/path-sandbox.js";

describe("isPathAllowed", () => {
  const root = "/home/user/project";

  it("根内路径放行", () => {
    expect(isPathAllowed(path.join(root, "src/index.ts"), { allowedRoots: [root] })).toBe(true);
  });

  it("精确匹配根放行", () => {
    expect(isPathAllowed(root, { allowedRoots: [root] })).toBe(true);
  });

  it("根外路径拒绝", () => {
    expect(isPathAllowed("/etc/passwd", { allowedRoots: [root] })).toBe(false);
  });

  it("前缀碰撞拒绝 — /foo/barbaz 不在 /foo/bar 内", () => {
    expect(isPathAllowed("/foo/barbaz", { allowedRoots: ["/foo/bar"] })).toBe(false);
  });

  it("空输入拒绝", () => {
    expect(isPathAllowed("", { allowedRoots: [root] })).toBe(false);
  });

  it("相对路径拒绝", () => {
    expect(isPathAllowed("src/index.ts", { allowedRoots: [root] })).toBe(false);
  });

  it("空根列表拒绝", () => {
    expect(isPathAllowed(root, { allowedRoots: [] })).toBe(false);
  });

  it(".. 穿越拒绝", () => {
    expect(isPathAllowed(path.join(root, "../etc/passwd"), { allowedRoots: [root] })).toBe(false);
  });

  it("多根任一命中即放行", () => {
    expect(
      isPathAllowed("/tmp/output.txt", {
        allowedRoots: ["/home/user/project", "/tmp"],
      }),
    ).toBe(true);
  });
});

describe("guardPath", () => {
  it("放行返回 null", () => {
    expect(guardPath("/home/user/project/src/a.ts", { allowedRoots: ["/home/user/project"] })).toBeNull();
  });

  it("拒绝返回错误消息", () => {
    const err = guardPath("/etc/passwd", { allowedRoots: ["/home/user/project"] });
    expect(err).not.toBeNull();
    expect(err).toContain("E_PATH_OUT_OF_SCOPE");
  });
});
