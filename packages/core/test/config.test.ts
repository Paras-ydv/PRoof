import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, resolveSettings } from "../src/config.js";

describe("resolveSettings", () => {
  it("returns defaults when nothing is overridden", () => {
    expect(resolveSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("starts every scored check in shadow mode", () => {
    const s = resolveSettings();
    expect(s.checks.ghostCode).toBe("shadow");
    expect(s.checks.spray).toBe("shadow");
  });

  it("applies repo overrides on top of org defaults", () => {
    const s = resolveSettings(
      { checks: { ghostCode: "live", spray: "off" }, weights: { size: 5 } },
      { checks: { spray: "live" } },
    );
    expect(s.checks.ghostCode).toBe("live");
    expect(s.checks.spray).toBe("live");
    expect(s.weights.size).toBe(5);
    expect(s.weights.ci).toBe(15);
  });

  it("replaces arrays instead of merging them", () => {
    const s = resolveSettings({ testPatterns: ["a/**"] }, { testPatterns: ["b/**"] });
    expect(s.testPatterns).toEqual(["b/**"]);
  });

  it("rejects invalid values", () => {
    expect(() => resolveSettings({ checks: { ci: "loud" as never } })).toThrow();
    expect(() => resolveSettings({ thresholds: { sizeSoftLimit: 500, sizeHardLimit: 400 } })).toThrow();
  });
});
