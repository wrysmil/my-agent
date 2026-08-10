import { describe, it, expect, vi, afterEach } from "vitest";
import { createLogger, type Logger, type LogLevel } from "../src/shared/logger.js";

describe("日志系统", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createLogger — 工厂函数", () => {
    it("返回实现 Logger 接口的对象", () => {
      const log = createLogger("test");
      expect(typeof log.debug).toBe("function");
      expect(typeof log.info).toBe("function");
      expect(typeof log.warn).toBe("function");
      expect(typeof log.error).toBe("function");
    });

    it("日志消息带模块名前缀", () => {
      const log = createLogger("my-module");
      const spy = vi.spyOn(console, "info").mockImplementation(() => {});

      log.info("hello");
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining("[my-module]"),
        "hello",
        "",
      );
    });

    it("默认级别为 info 时，debug 不输出", () => {
      const log = createLogger("test"); // 默认 info
      const spy = vi.spyOn(console, "debug").mockImplementation(() => {});

      log.debug("should not appear");
      expect(spy).not.toHaveBeenCalled();
    });

    it("默认级别为 info 时，info/warn/error 都输出", () => {
      const log = createLogger("test");
      const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      log.info("info msg");
      log.warn("warn msg");
      log.error("error msg");

      expect(infoSpy).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    });

    it("debug 级别输出所有消息", () => {
      const log = createLogger("test", "debug");
      const spy = vi.spyOn(console, "debug").mockImplementation(() => {});

      log.debug("debug msg");
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining("[test]"),
        "debug msg",
        "",
      );
    });

    it("error 级别只输出 error", () => {
      const log = createLogger("test", "error");
      const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      log.info("info");
      log.warn("warn");
      log.error("error");

      expect(infoSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    });

    it("支持额外参数传递", () => {
      const log = createLogger("test");
      const spy = vi.spyOn(console, "info").mockImplementation(() => {});

      log.info("request", { method: "GET", url: "/api" });
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining("[test]"),
        "request",
        expect.stringContaining('"method":"GET"'),
      );
    });
  });

  describe("LogLevel — 类型约束", () => {
    it("LogLevel 包含四个级别", () => {
      const levels: LogLevel[] = ["debug", "info", "warn", "error"];
      expect(levels).toHaveLength(4);
    });
  });
});
