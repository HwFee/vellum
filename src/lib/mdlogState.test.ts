import { describe, expect, it } from "vitest";
import { computeRecheckDelay } from "./mdlogState";

describe("computeRecheckDelay", () => {
  it("computes remaining milliseconds until expiration", () => {
    const now = 1_000_000;
    const expiresAt = 1_030_000;
    expect(computeRecheckDelay(expiresAt, now)).toBe(30_000);
  });

  it("returns 0 when expiresAt is in the past", () => {
    const now = 1_000_000;
    const expiresAt = 999_000;
    expect(computeRecheckDelay(expiresAt, now)).toBe(0);
  });

  it("returns 0 when expiresAt equals current time", () => {
    const now = 1_000_000;
    expect(computeRecheckDelay(now, now)).toBe(0);
  });

  it("clamps delay to 2^31 - 1 when delay exceeds 32-bit signed integer limit", () => {
    const now = 1_000_000;
    const farFuture = now + 3_000_000_000; // > 2^31 - 1
    expect(computeRecheckDelay(farFuture, now)).toBe(2_147_483_647);
  });
});
