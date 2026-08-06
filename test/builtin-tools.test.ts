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
import { _resetDataRoot } from "../src/storage/paths.js";

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

describe("resolvePath 沙箱：skill 根可达（S1.6）", () => {
  const originalHome = process.env.MY_AGENT_HOME;
  let wd: string;
  let home: string;

  beforeEach(() => {
    wd = tempDir();
    home = fs.mkdtempSync(path.join(os.tmpdir(), "my-agent-home-"));
    process.env.MY_AGENT_HOME = home;
    _resetDataRoot();

    // custom skill：<home>/skills/hello-skill/SKILL.md
    const skillDir = path.join(home, "skills", "hello-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: hello-skill\n---\n# Hello Skill\n",
      "utf-8",
    );

    // marketplace skill：<home>/marketplace/skills/mkt-skill/SKILL.md
    const mktDir = path.join(home, "marketplace", "skills", "mkt-skill");
    fs.mkdirSync(mktDir, { recursive: true });
    fs.writeFileSync(path.join(mktDir, "SKILL.md"), "# Market Skill\n", "utf-8");
  });

  afterEach(() => {
    fs.rmSync(wd, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
    if (originalHome) process.env.MY_AGENT_HOME = originalHome;
    else delete process.env.MY_AGENT_HOME;
    _resetDataRoot();
  });

  it("应能读取 userSkillsDir 下的 SKILL.md", async () => {
    const skillPath = path.join(home, "skills", "hello-skill", "SKILL.md");
    const result = await readFileTool.execute({ filePath: skillPath }, ctx(wd));
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("Hello Skill");
  });

  it("应能读取 userMarketplaceSkillsDir 下的 SKILL.md", async () => {
    const skillPath = path.join(home, "marketplace", "skills", "mkt-skill", "SKILL.md");
    const result = await readFileTool.execute({ filePath: skillPath }, ctx(wd));
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("Market Skill");
  });

  it("工作目录与 skill 根之外的路径仍被拒绝", async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "my-agent-outside-"));
    try {
      const secret = path.join(outside, "secret.txt");
      fs.writeFileSync(secret, "top secret", "utf-8");
      await expect(readFileTool.execute({ filePath: secret }, ctx(wd))).rejects.toThrow(
        /E_PATH_OUT_OF_SCOPE/,
      );
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it(".. 路径穿越仍被拒绝", async () => {
    // 从 skill 根向上穿越，归一化后落到所有允许根之外
    const escaped = path.join(home, "skills", "..", "..", "secret.txt");
    await expect(readFileTool.execute({ filePath: escaped }, ctx(wd))).rejects.toThrow(
      /E_PATH_(OUT_OF_SCOPE|TRAVERSAL)/,
    );
  });

  it("MY_AGENT_HOME 切换后 skill 根跟随新值", async () => {
    const home1 = home;
    const skill1 = path.join(home1, "skills", "hello-skill", "SKILL.md");
    const first = await readFileTool.execute({ filePath: skill1 }, ctx(wd));
    expect(first.isError).toBeFalsy();

    const home2 = fs.mkdtempSync(path.join(os.tmpdir(), "my-agent-home2-"));
    try {
      const skill2Dir = path.join(home2, "skills", "another-skill");
      fs.mkdirSync(skill2Dir, { recursive: true });
      fs.writeFileSync(
        path.join(skill2Dir, "SKILL.md"),
        "# Another Skill\n",
        "utf-8",
      );

      process.env.MY_AGENT_HOME = home2;
      _resetDataRoot();

      const second = await readFileTool.execute(
        { filePath: path.join(home2, "skills", "another-skill", "SKILL.md") },
        ctx(wd),
      );
      expect(second.isError).toBeFalsy();
      expect(second.content).toContain("Another Skill");

      // 旧 home1 的 skill 根不再可达
      await expect(readFileTool.execute({ filePath: skill1 }, ctx(wd))).rejects.toThrow(
        /E_PATH_OUT_OF_SCOPE/,
      );
    } finally {
      fs.rmSync(home2, { recursive: true, force: true });
    }
  });
});
