import { describe, expect, it } from "vitest";
import {
  pickOrderedMarketPrice,
  pickRepresentativeMarketPrice,
  pickVariantMarketPrice,
} from "./market-price";

describe("market price selection", () => {
  it("uses a representative value instead of the first tiny field", () => {
    expect(
      pickRepresentativeMarketPrice([0.07, 0.07, 0.05, 0.06, 1.24]),
    ).toBe(0.07);
  });

  it("uses ordered market fields when source priority matters", () => {
    expect(pickOrderedMarketPrice([3.62, 2.13, 3.43, 0.5, 2.39])).toBe(3.62);
  });

  it("uses holo pricing when normal pricing looks like the wrong variant", () => {
    const price = pickVariantMarketPrice(
      [0.07, 0.07, 0.05, 0.06, 1.24],
      [12.68, 5.14, 11.99, 40, 5.97],
    );

    expect(price).toBe(12.68);
  });

  it("keeps normal pricing when holo pricing is not clearly a separate value", () => {
    const price = pickVariantMarketPrice(
      [47.91, 46.54, 47.44, 48.31, 46.63],
      [0, null, undefined],
    );

    expect(price).toBe(47.91);
  });
});
