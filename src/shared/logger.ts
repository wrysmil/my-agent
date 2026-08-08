export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  child(subsystem: string): Logger;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function timestampPrefix(): string {
  return new Date().toISOString();
}

export function createLogger(
  subsystem: string,
  level: LogLevel = "info",
): Logger {
  // 运行时兜底：非法 level 回退到 info，避免所有日志静默
  const threshold = LOG_LEVELS[level] ?? LOG_LEVELS.info;
  const prefix = `[${timestampPrefix()}] [${subsystem}]`;

  function shouldLog(lvl: LogLevel): boolean {
    return LOG_LEVELS[lvl] >= threshold;
  }

  function formatData(data?: Record<string, unknown>): string {
    if (!data || Object.keys(data).length === 0) return "";
    try {
      return " " + JSON.stringify(data);
    } catch {
      return " [unserializable data]";
    }
  }

  const logger: Logger = {
    debug(msg, data) {
      if (shouldLog("debug")) console.debug(prefix, msg, formatData(data));
    },
    info(msg, data) {
      if (shouldLog("info")) console.info(prefix, msg, formatData(data));
    },
    warn(msg, data) {
      if (shouldLog("warn")) console.warn(prefix, msg, formatData(data));
    },
    error(msg, data) {
      if (shouldLog("error")) console.error(prefix, msg, formatData(data));
    },
    child(sub: string): Logger {
      return createLogger(`${subsystem}/${sub}`, level);
    },
  };

  return logger;
}
