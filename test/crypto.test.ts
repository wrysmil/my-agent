import { describe, it, expect } from "vitest";
import { encryptApiKey, decryptApiKey } from "../src/util/crypto.js";

describe("crypto — API Key 加解密", () => {
  it("encrypt + decrypt roundtrip", () => {
    const plain = "sk-abc123def456ghijklmnopqrstuvwxyz";
    const encoded = encryptApiKey(plain);
    expect(encoded).not.toBe(plain);
    expect(encoded).toContain(":"); // format: iv:tag:ciphertext

    const decoded = decryptApiKey(encoded);
    expect(decoded).toBe(plain);
  });

  it("相同明文两次加密产生不同密文（随机 IV）", () => {
    const plain = "my-secret-key";
    const e1 = encryptApiKey(plain);
    const e2 = encryptApiKey(plain);
    expect(e1).not.toBe(e2);
  });

  it("不同密钥产生不同密文", () => {
    const e1 = encryptApiKey("key-a");
    const e2 = encryptApiKey("key-b");
    expect(e1).not.toBe(e2);
  });

  it("空字符串 roundtrip", () => {
    const encoded = encryptApiKey("");
    const decoded = decryptApiKey(encoded);
    expect(decoded).toBe("");
  });

  it("特殊字符 roundtrip", () => {
    const plain = "key\nwith\t特殊字符:!@#$%^&*(){}[]<>?/\\|";
    const encoded = encryptApiKey(plain);
    const decoded = decryptApiKey(encoded);
    expect(decoded).toBe(plain);
  });

  it("长密钥 roundtrip (1KB)", () => {
    const plain = "sk-" + "x".repeat(1000);
    const encoded = encryptApiKey(plain);
    const decoded = decryptApiKey(encoded);
    expect(decoded).toBe(plain);
  });

  it("明文不包含在密文中", () => {
    const plain = "sk-secret-12345";
    const encoded = encryptApiKey(plain);
    expect(encoded).not.toContain(plain);
  });
});
