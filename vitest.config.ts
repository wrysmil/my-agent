import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 包含 test/（CLI / 集成 / WU 旧测试）与 src/（服务端单测；
    // 例如 src/web/server/index.test.ts 与源码同目录）。
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
  },
});
