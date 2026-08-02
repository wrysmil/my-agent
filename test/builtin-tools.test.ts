/**
 * 内置工具测试
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  readFileTool,
  writeFileTool,
  editFileTool,
  listFilesTool,
  searchFilesTool,
  grepFilesTool,
} from "../src/tools/builtin.js";
import type { ToolContext } from "../src/tools/base.js";

function tempDir() {
  const dir = path.join(os.tmpdir(), `my-agent-tool-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ctx(dir: string): ToolContext {
  return { workingDir: dir, state: {} };
}

describe("read_file 工具", () => {
  let dir: string;

  beforeEach(() => {
    dir = tempDir();
    fs.writeFileSync(path.join(dir, "test.txt"), "line1\nline2\nline3\nline4\nline5\n");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("应该读取整个文件", async () => {
    const result = await readFileTool.execute({ filePath: "test.txt" }, ctx(dir));
    expect(result.content).toContain("line1");
    expect(result.content).toContain("line5");
    expect(result.content).toContain("6 行");
  });

  it("应该支持行号范围", async () => {
    const result = await readFileTool.execute(
      { filePath: "test.txt", offset: 2, limit: 2 },
      ctx(dir),
    );
    expect(result.content).toContain("line2");
    expect(result.content).toContain("line3");
    expect(result.content).not.toContain("line1");
    expect(result.content).not.toContain("line5");
  });

  it("文件不存在应返回错误", async () => {
    const result = await readFileTool.execute(
      { filePath: "nonexistent.txt" },
      ctx(dir),
    );
    expect(result.isError).toBe(true);
  });
});

describe("write_file 工具", () => {
  let dir: string;

  beforeEach(() => {
    dir = tempDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("应该写入文件", async () => {
    const result = await writeFileTool.execute(
      { filePath: "output.txt", content: "hello world" },
      ctx(dir),
    );
    expect(result.isError).toBeFalsy();

    const content = fs.readFileSync(path.join(dir, "output.txt"), "utf-8");
    expect(content).toBe("hello world");
  });

  it("应该自动创建父目录", async () => {
    await writeFileTool.execute(
      { filePath: "sub/deep/nested/file.txt", content: "deep" },
      ctx(dir),
    );
    expect(fs.existsSync(path.join(dir, "sub/deep/nested/file.txt"))).toBe(true);
  });
});

describe("edit_file 工具", () => {
  let dir: string;

  beforeEach(() => {
    dir = tempDir();
    fs.writeFileSync(
      path.join(dir, "config.ts"),
      'const port = 3000;\nconst host = "localhost";\n',
    );
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("应该替换唯一匹配", async () => {
    const result = await editFileTool.execute(
      { filePath: "config.ts", oldString: "3000", newString: "8080" },
      ctx(dir),
    );
    expect(result.isError).toBeFalsy();

    const content = fs.readFileSync(path.join(dir, "config.ts"), "utf-8");
    expect(content).toContain("port = 8080");
    expect(content).not.toContain("port = 3000");
  });

  it("不唯一匹配应报错", async () => {
    // 写一个包含重复字符串的文件
    fs.writeFileSync(
      path.join(dir, "dup.txt"),
      "const a = 1;\nconst b = 1;\n",
    );

    const result = await editFileTool.execute(
      { filePath: "dup.txt", oldString: "1", newString: "2" },
      ctx(dir),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("不唯一");
  });

  it("replaceAll 应该替换所有匹配", async () => {
    fs.writeFileSync(
      path.join(dir, "dup.txt"),
      "const a = 1;\nconst b = 1;\n",
    );

    const result = await editFileTool.execute(
      { filePath: "dup.txt", oldString: "1", newString: "2", replaceAll: true },
      ctx(dir),
    );
    expect(result.isError).toBeFalsy();

    const content = fs.readFileSync(path.join(dir, "dup.txt"), "utf-8");
    expect(content).toBe("const a = 2;\nconst b = 2;\n");
  });

  it("未找到匹配应报错", async () => {
    const result = await editFileTool.execute(
      { filePath: "config.ts", oldString: "xyz_nonexistent_xyz", newString: "abc" },
      ctx(dir),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("未找到");
  });
});

describe("list_files 工具", () => {
  let dir: string;

  beforeEach(() => {
    dir = tempDir();
    fs.writeFileSync(path.join(dir, "a.ts"), "");
    fs.writeFileSync(path.join(dir, "b.ts"), "");
    fs.mkdirSync(path.join(dir, "sub"));
    fs.writeFileSync(path.join(dir, "sub", "c.ts"), "");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("应该列出目录内容", async () => {
    const result = await listFilesTool.execute({ dirPath: dir }, ctx(dir));
    expect(result.content).toContain("a.ts");
    expect(result.content).toContain("b.ts");
    expect(result.content).toContain("sub/");
  });

  it("应该支持模式过滤", async () => {
    const result = await listFilesTool.execute(
      { dirPath: dir, pattern: "*.ts", depth: 2 },
      ctx(dir),
    );
    expect(result.content).toContain("a.ts");
    expect(result.content).toContain("c.ts");
  });
});

describe("search_files 工具", () => {
  let dir: string;

  beforeEach(() => {
    dir = tempDir();
    fs.writeFileSync(path.join(dir, "app.ts"), "");
    fs.writeFileSync(path.join(dir, "app.test.ts"), "");
    fs.writeFileSync(path.join(dir, "README.md"), "");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("应该按 glob 搜索文件", async () => {
    const result = await searchFilesTool.execute(
      { pattern: "*.ts", dirPath: dir },
      ctx(dir),
    );
    expect(result.content).toContain("app.ts");
    expect(result.content).toContain("app.test.ts");
    expect(result.content).not.toContain("README.md");
  });

  it("应该按更精确的 glob 搜索", async () => {
    const result = await searchFilesTool.execute(
      { pattern: "*.test.ts", dirPath: dir },
      ctx(dir),
    );
    expect(result.content).toContain("app.test.ts");
    expect(result.content).not.toContain("app.ts");
  });
});

describe("grep_files 工具", () => {
  let dir: string;

  beforeEach(() => {
    dir = tempDir();
    fs.writeFileSync(
      path.join(dir, "code.ts"),
      "import { foo } from './foo';\nexport const bar = foo + 1;\n",
    );
    fs.writeFileSync(path.join(dir, "readme.md"), "# Project\n\nThis is a test project.\n");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("应该搜索文件内容", async () => {
    const result = await grepFilesTool.execute(
      { query: "import", dirPath: dir },
      ctx(dir),
    );
    expect(result.content).toContain("code.ts");
    expect(result.content).toContain("import { foo }");
  });

  it("应该支持 glob 过滤", async () => {
    const result = await grepFilesTool.execute(
      { query: "test", dirPath: dir, glob: "*.md" },
      ctx(dir),
    );
    expect(result.content).toContain("readme.md");
    expect(result.content).not.toContain("code.ts");
  });

  it("无匹配应返回提示", async () => {
    const result = await grepFilesTool.execute(
      { query: "xyz_nonexistent_pattern_xyz", dirPath: dir },
      ctx(dir),
    );
    expect(result.content).toContain("未找到匹配");
  });
});
