import { describe, it, expect } from "vitest";
import { mainMenuChoices, providerMenuChoices } from "../src/cli/menu.js";
import { pickHistoryIndex } from "../chat.js";

describe("menu choices", () => {
  it("mainMenu returns the five canonical choices", () => {
    expect(mainMenuChoices).toEqual([
      "start",
      "history",
      "settings",
      "view",
      "quit",
    ]);
  });

  it("providerMenu returns the six canonical choices", () => {
    expect(providerMenuChoices).toEqual([
      "list",
      "edit",
      "switch",
      "toggle",
      "delete",
      "back",
    ]);
  });
});

describe("pickHistoryIndex", () => {
  it("returns 0 for back-to-main input", () => {
    expect(pickHistoryIndex("0", 5)).toBe(0);
  });

  it("returns the 1-based index for a valid choice", () => {
    expect(pickHistoryIndex("1", 5)).toBe(1);
    expect(pickHistoryIndex("3", 5)).toBe(3);
    expect(pickHistoryIndex("5", 5)).toBe(5);
  });

  it("returns null for out-of-range choices", () => {
    expect(pickHistoryIndex("0", 0)).toBe(0);
    expect(pickHistoryIndex("6", 5)).toBeNull();
    expect(pickHistoryIndex("99", 5)).toBeNull();
  });

  it("returns null for non-numeric input", () => {
    expect(pickHistoryIndex("abc", 5)).toBeNull();
    expect(pickHistoryIndex("-1", 5)).toBeNull();
    expect(pickHistoryIndex("1.5", 5)).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(pickHistoryIndex("", 5)).toBeNull();
  });
});
