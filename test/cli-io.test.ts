import { describe, it, expect } from "vitest";
import * as readline from "node:readline";
import { Writable, Readable } from "node:stream";
import { colorize, colorNumber, formatBanner, formatMenuItem, prompt } from "../src/cli/io.js";

class MockWritable extends Writable {
  public chunks: string[] = [];
  override _write(chunk: Buffer, _enc: string, cb: () => void) {
    this.chunks.push(chunk.toString());
    cb();
  }
  get text() {
    return this.chunks.join("");
  }
}

class MockReadable extends Readable {
  private data: string;
  private pos = 0;
  constructor(data: string) {
    super();
    this.data = data;
  }
  override _read(size: number) {
    if (this.pos < this.data.length) {
      this.push(this.data.slice(this.pos, this.pos + size));
      this.pos += size;
    } else {
      this.push(null);
    }
  }
}

function makeRl(input: string, output: MockWritable) {
  return readline.createInterface({
    input: new MockReadable(input + "\n"),
    output,
    terminal: true,
  });
}

describe("io color helpers", () => {
  it("colorize wraps text with ANSI escape", () => {
    expect(colorize("hi", 31)).toBe("\x1b[31mhi\x1b[0m");
  });

  it("colorNumber returns the numeral with color cycle", () => {
    expect(colorNumber(1, 31)).toBe("\x1b[31m①\x1b[0m");
    expect(colorNumber(6, 36)).toBe("\x1b[36m⑥\x1b[0m");
  });

  it("formatBanner produces a box containing title", () => {
    const banner = formatBanner("My Agent");
    expect(banner).toContain("My Agent");
    expect(banner).toContain("┌");
    expect(banner).toContain("└");
  });

  it("formatMenuItem renders numeral + label", () => {
    const line = formatMenuItem(1, "开始对话", 31);
    expect(line).toContain("\x1b[31m①\x1b[0m");
    expect(line).toContain("开始对话");
  });

  it("respects NO_COLOR env", () => {
    process.env.NO_COLOR = "1";
    try {
      expect(colorize("hi", 31)).toBe("hi");
    } finally {
      delete process.env.NO_COLOR;
    }
  });
});

describe("prompt", () => {
  it("returns trimmed input", async () => {
    const out = new MockWritable();
    const rl = makeRl("  hello  ", out);
    const result = await prompt(rl, "Q: ");
    expect(result).toBe("hello");
    expect(out.text).toContain("Q:");
  });

  it("returns empty string for empty input", async () => {
    const out = new MockWritable();
    const rl = makeRl("", out);
    expect(await prompt(rl, "Q: ")).toBe("");
  });
});
