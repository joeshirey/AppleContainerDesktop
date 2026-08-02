import { describe, it, expect } from "vitest";
import { positiveInt } from "../../lib/validation";

// positiveInt is now called from two places (BuildModal and BuilderView) so
// its boundary conditions belong in a focused unit test rather than being
// discovered implicitly through component tests at either call site.
describe("positiveInt", () => {
  it("returns undefined for an empty string", () => {
    expect(positiveInt("")).toBeUndefined();
  });

  it("returns undefined for a blank string", () => {
    expect(positiveInt("   ")).toBeUndefined();
  });

  // Zero is the exact boundary the error message promises ("1 or more").
  it("returns undefined for zero", () => {
    expect(positiveInt("0")).toBeUndefined();
  });

  it("returns undefined for a negative number", () => {
    expect(positiveInt("-1")).toBeUndefined();
  });

  // A fractional count survives JSON intact and dies in serde as a raw
  // deserialiser string in the UI.
  it("returns undefined for a fractional number", () => {
    expect(positiveInt("1.5")).toBeUndefined();
  });

  // NaN serialises to JSON null and reaches the backend as "unset", so the
  // build would silently run at the default allocation.
  it("returns undefined for a non-numeric string", () => {
    expect(positiveInt("abc")).toBeUndefined();
  });

  it("returns the integer for a valid positive integer", () => {
    expect(positiveInt("4")).toBe(4);
  });

  it("trims whitespace before parsing", () => {
    expect(positiveInt(" 4 ")).toBe(4);
  });
});
