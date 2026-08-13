/**
 * DISPATCH_GUIDELINE 常量测试。
 *
 * 覆盖：
 * 1. 常量是非空字符串
 * 2. 文案包含三个调度工具名（run_worker / dispatch_to / hand_off_to），防止被误删
 */

import { describe, it, expect } from "vitest";
import { DISPATCH_GUIDELINE } from "../../src/prompts/dispatch-guideline.js";

describe("DISPATCH_GUIDELINE", () => {
  it("是非空字符串", () => {
    expect(typeof DISPATCH_GUIDELINE).toBe("string");
    expect(DISPATCH_GUIDELINE.length).toBeGreaterThan(0);
    expect(DISPATCH_GUIDELINE.trim().length).toBeGreaterThan(0);
  });

  it("包含 run_worker 调度说明", () => {
    expect(DISPATCH_GUIDELINE).toContain("run_worker");
  });

  it("包含 dispatch_to 调度说明", () => {
    expect(DISPATCH_GUIDELINE).toContain("dispatch_to");
  });

  it("包含 hand_off_to 调度说明", () => {
    expect(DISPATCH_GUIDELINE).toContain("hand_off_to");
  });
});
