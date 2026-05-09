import { describe, expect, it } from "vitest";
import {
  buildScanSearchQueries,
  extractCardNumbers,
  extractDealScan,
  extractPsaCertNumbers,
  extractSetCodes,
  extractYenPrices,
  pickBestYenPrice,
} from "./ocr";

describe("OCR extraction helpers", () => {
  it("extracts collector numbers from card OCR text", () => {
    expect(extractCardNumbers("205/172")).toEqual(["205"]);
    expect(extractCardNumbers("001/005")).toEqual(["1"]);
    expect(extractCardNumbers("064/131")).toEqual(["64"]);
    expect(extractCardNumbers("card text 205 / 172 rarity")).toEqual(["205"]);
    expect(extractCardNumbers("Blaziken VMAX TG15")).toEqual(["TG15"]);
  });

  it("extracts set codes from noisy OCR text", () => {
    expect(extractSetCodes("sv2a 175")).toEqual(["SV2a"]);
    expect(extractSetCodes("msv2a 177")).toEqual(["SV2a"]);
    expect(extractSetCodes("Blaziken SIT TG15")).toEqual(["SIT"]);
    expect(extractSetCodes("Pikachu FUT20 1")).toEqual(["FUT20"]);
  });

  it("extracts labeled Japanese yen prices", () => {
    expect(pickBestYenPrice("¥12,800")).toBe(12800);
    expect(pickBestYenPrice("Y12,800")).toBe(12800);
    expect(pickBestYenPrice("12,800円")).toBe(12800);
    expect(pickBestYenPrice("12 800円")).toBe(12800);
    expect(pickBestYenPrice("税込 12,800")).toBe(12800);
    expect(pickBestYenPrice("税込 I2,8OO")).toBe(12800);
    expect(pickBestYenPrice("特価 9,800")).toBe(9800);
    expect(pickBestYenPrice("9800")).toBe(9800);
  });

  it("prefers yen and tax labeled prices over unrelated numbers", () => {
    expect(pickBestYenPrice("205/172 HP 330 税込 12,800")).toBe(12800);
    expect(pickBestYenPrice("棚 42 在庫 3 ¥9,800")).toBe(9800);
  });

  it("does not merge nearby attack damage into yen prices", () => {
    expect(pickBestYenPrice("税込 ¥5,000 80")).toBe(5000);
    expect(pickBestYenPrice("¥5000 80")).toBe(5000);
    expect(pickBestYenPrice("税込 5 000 80")).toBe(5000);
    expect(pickBestYenPrice("PRICE I2,8OO 80")).toBe(12800);
    expect(extractYenPrices("税込 ¥5,000 80")).toEqual([5000]);
  });

  it("returns all unique prices by confidence", () => {
    expect(extractYenPrices("税込 12,800 / ¥9,800 / 9800")).toEqual([
      12800,
      9800,
    ]);
  });

  it("returns no price for invalid OCR text", () => {
    expect(pickBestYenPrice("Pikachu 205/172 HP 70")).toBeUndefined();
    expect(pickBestYenPrice("HP 330 attack 80")).toBeUndefined();
    expect(extractYenPrices("no price")).toEqual([]);
  });

  it("extracts card number and yen price from one deal photo OCR text", () => {
    expect(extractDealScan("Pikachu ex 205/172 税込 ¥12,800")).toEqual({
      cardNumbers: ["205"],
      psaCerts: [],
      rawText: "Pikachu ex 205/172 税込 ¥12,800",
      searchQueries: ["Pikachu ex 205", "Pikachu ex", "205"],
      setCodes: [],
      yenPrice: 12800,
    });
  });

  it("builds robust card search queries from scan evidence", () => {
    expect(
      buildScanSearchQueries({
        cardNumbers: ["TG15"],
        nameCandidates: ["Blaziken VMAX"],
        setCodes: ["SIT"],
      }),
    ).toEqual([
      "SIT TG15",
      "Blaziken VMAX SIT TG15",
      "Blaziken VMAX TG15",
      "Blaziken VMAX",
      "TG15",
    ]);

    expect(
      buildScanSearchQueries({
        cardNumbers: ["175"],
        setCodes: ["SV2a"],
      }),
    ).toEqual(["SV2a 175", "175"]);
  });

  it("extracts PSA cert numbers only when cert context is visible", () => {
    expect(extractPsaCertNumbers("PSA CERT 12345678 GEM MT 10")).toEqual([
      "12345678",
    ]);
    expect(extractPsaCertNumbers("税込 12345678")).toEqual([]);
  });
});
