import { describe, it, expect } from "vitest";
import { mainMenuChoices, providerMenuChoices } from "../src/cli/menu.js";

describe("menu choices", () => {
  it("mainMenu returns the four canonical choices", () => {
    expect(mainMenuChoices).toEqual([
      "start",
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
