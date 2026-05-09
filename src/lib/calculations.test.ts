import { describe, expect, it } from "vitest";
import {
  calculateCostDkk,
  calculateDeal,
  cleanNumber,
  decideFromMargin,
  DEFAULT_SETTINGS,
  normalizeRawCondition,
} from "./calculations";

describe("deal calculation logic", () => {
  it("calculates a raw BUY from raw market value", () => {
    const result = calculateDeal("raw", 10000, {
      rawDkk: 600,
      sources: ["manual"],
    });

    expect(result.costDkk).toBe(400);
    expect(result.netReferenceValueDkk).toBe(570);
    expect(result.profitDkk).toBe(170);
    expect(result.marginPercent).toBe(42.5);
    expect(result.decision).toBe("BUY");
    expect(result.displayState).toBe("ready");
    expect(result.route?.id).toBe("raw_flip");
  });

  it("calculates a PSA 9 MAYBE from PSA 9 value only", () => {
    const result = calculateDeal("psa9", 20000, {
      rawDkk: 100,
      psa9Dkk: 1000,
      psa10Dkk: 5000,
      sources: ["manual"],
    });

    expect(result.costDkk).toBe(800);
    expect(result.netReferenceValueDkk).toBe(950);
    expect(result.profitDkk).toBe(150);
    expect(result.marginPercent).toBe(18.75);
    expect(result.decision).toBe("MAYBE");
    expect(result.route?.id).toBe("psa9_slab");
  });

  it("calculates a PSA 10 BUY from PSA 10 value only", () => {
    const result = calculateDeal("psa10", 30000, {
      rawDkk: 10,
      psa9Dkk: 20,
      psa10Dkk: 1700,
      sources: ["manual"],
    });

    expect(result.costDkk).toBe(1200);
    expect(result.netReferenceValueDkk).toBe(1615);
    expect(result.profitDkk).toBe(415);
    expect(result.marginPercent).toBeCloseTo(34.58, 2);
    expect(result.decision).toBe("BUY");
    expect(result.route?.id).toBe("psa10_slab");
  });

  it("subtracts grading fee for raw to PSA 9 routes", () => {
    const result = calculateDeal("raw", 10000, {
      rawDkk: 100,
      psa9Dkk: 1000,
      sources: ["manual"],
    });
    const psa9 = result.routes.find((route) => route.id === "grade_psa9");

    expect(psa9?.costDkk).toBe(620);
    expect(psa9?.netDkk).toBe(950);
    expect(psa9?.profitDkk).toBe(330);
    expect(psa9?.marginPercent).toBeCloseTo(53.23, 2);
    expect(psa9?.decision).toBe("BUY");
    expect(result.route?.id).toBe("grade_psa9");
  });

  it("subtracts grading fee for raw to PSA 10 routes", () => {
    const result = calculateDeal("raw", 10000, {
      rawDkk: 100,
      psa10Dkk: 1400,
      sources: ["manual"],
    });
    const psa10 = result.routes.find((route) => route.id === "grade_psa10");

    expect(psa10?.costDkk).toBe(620);
    expect(psa10?.netDkk).toBe(1330);
    expect(psa10?.profitDkk).toBe(710);
    expect(psa10?.marginPercent).toBeCloseTo(114.52, 2);
    expect(psa10?.decision).toBe("BUY");
    expect(result.route?.id).toBe("grade_psa10");
  });

  it("does not include grading fee for already graded slabs", () => {
    const result = calculateDeal("psa9", 10000, {
      psa9Dkk: 800,
      sources: ["manual"],
    });

    expect(result.route?.costDkk).toBe(400);
    expect(result.route?.profitDkk).toBe(360);
  });

  it("flags the PSA 10 trap for raw cards", () => {
    const result = calculateDeal("raw", 10000, {
      rawDkk: 430,
      psa9Dkk: 390,
      psa10Dkk: 1200,
      sources: ["manual"],
    });

    expect(result.warning).toBe("PSA_10_TRAP");
  });

  it("caps high-end BUY decisions at MAYBE", () => {
    const result = calculateDeal("psa10", 100000, {
      psa10Dkk: 8000,
      sources: ["manual"],
    });

    expect(result.costDkk).toBe(4000);
    expect(result.marginPercent).toBe(90);
    expect(result.decision).toBe("MAYBE");
    expect(result.warning).toBe("HIGH_END_RISK");
  });

  it("does not calculate misleading zero margins when values are missing", () => {
    const result = calculateDeal("raw", 10000, {
      sources: [],
    });

    expect(result.costDkk).toBe(400);
    expect(result.referenceValueUsedDkk).toBeUndefined();
    expect(result.netReferenceValueDkk).toBeUndefined();
    expect(result.profitDkk).toBeUndefined();
    expect(result.marginPercent).toBeUndefined();
    expect(result.decision).toBe("SKIP");
    expect(result.displayState).toBe("missing");
    expect(result.warning).toBe("VALUES_MISSING");
  });

  it("does not show a ready decision before the shop price is entered", () => {
    const result = calculateDeal("raw", 0, {
      rawDkk: 600,
      sources: ["manual"],
    });

    expect(result.displayState).toBe("idle");
    expect(result.marginPercent).toBeUndefined();
  });

  it("uses the editable yen divisor", () => {
    expect(calculateCostDkk(12500, DEFAULT_SETTINGS)).toBe(500);
    expect(
      calculateCostDkk(12500, { ...DEFAULT_SETTINGS, yenDivisor: 20 }),
    ).toBe(625);
  });

  it("maps margins to simple in-store decisions", () => {
    expect(decideFromMargin(30)).toBe("BUY");
    expect(decideFromMargin(29.99)).toBe("MAYBE");
    expect(decideFromMargin(15)).toBe("MAYBE");
    expect(decideFromMargin(14.99)).toBe("SKIP");
  });

  it("cleans formatted shop input into numbers", () => {
    expect(cleanNumber("¥12,800")).toBe(12800);
    expect(cleanNumber("12800円")).toBe(12800);
    expect(cleanNumber("税込 9.800")).toBe(9800);
    expect(cleanNumber("42,5")).toBe(42.5);
  });

  it("migrates old raw condition values to Cardmarket condition codes", () => {
    expect(normalizeRawCondition("mint")).toBe("MT");
    expect(normalizeRawCondition("near_mint")).toBe("NM");
    expect(normalizeRawCondition("light_play")).toBe("LP");
    expect(normalizeRawCondition("moderate_play")).toBe("PL");
    expect(normalizeRawCondition("heavy_play")).toBe("PO");
    expect(normalizeRawCondition("NM")).toBe("NM");
  });
});
