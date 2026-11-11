import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hint, safeEqual, signBody, Vault } from "../src/crypto.js";

describe("Vault", () => {
  const vault = new Vault(randomBytes(32).toString("base64"));

  it("round-trips and uses a fresh IV each time", () => {
    const a = vault.encrypt("sk-ant-secret");
    const b = vault.encrypt("sk-ant-secret");
    expect(a).not.toBe(b);
    expect(vault.decrypt(a)).toBe("sk-ant-secret");
  });

  it("rejects tampered values and wrong keys", () => {
    const v = vault.encrypt("x");
    const parts = v.split(".");
    parts[3] = Buffer.from("y").toString("base64url");
    expect(() => vault.decrypt(parts.join("."))).toThrow();
    expect(() => new Vault(randomBytes(32).toString("base64")).decrypt(v)).toThrow();
    expect(() => new Vault("short")).toThrow(/32 bytes/);
  });
});

describe("helpers", () => {
  it("hides all but the last 4 characters", () => {
    expect(hint("sk-ant-api03-abcdefgh1234")).toBe("••••1234");
    expect(hint("short")).toBe("••••");
  });

  it("signs bodies deterministically", () => {
    expect(signBody("s", "{}", 1)).toBe(signBody("s", "{}", 1));
    expect(safeEqual(signBody("s", "{}", 1), signBody("s", "{}", 2))).toBe(false);
  });
});
