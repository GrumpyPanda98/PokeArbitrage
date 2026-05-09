import { describe, expect, it } from "vitest";
import {
  buildPokePricesCardSlug,
  buildPokePricesSearchQuery,
  getPokePricesSetNameCandidates,
  parsePokePricesHtml,
  shouldUsePokePricesForCard,
} from "./pokeprices";

describe("PokePrices helpers", () => {
  it("builds card page slugs from selected card identity", () => {
    expect(
      buildPokePricesCardSlug({
        name: "Blaziken VMAX",
        cardNumber: "TG15/195",
      }),
    ).toBe("blaziken-vmax-tg15");

    expect(
      buildPokePricesCardSlug({
        name: "Pikachu on the Ball",
        cardNumber: "1/5",
      }),
    ).toBe("pikachu-on-the-ball-1");
  });

  it("builds compact search queries for PokePrices global search", () => {
    expect(
      buildPokePricesSearchQuery({
        name: "Psyduck",
        cardNumber: "175/165",
      }),
    ).toBe("PSYDUCK 175");

    expect(
      buildPokePricesSearchQuery({
        name: "Blaziken VMAX",
        cardNumber: "TG15/195",
      }),
    ).toBe("BLAZIKEN VMAX tg15");
  });

  it("maps TCGdex 151 names to the PokePrices set name", () => {
    expect(
      getPokePricesSetNameCandidates({
        setName: "151",
        tcgDexSetId: "sv03.5",
      }),
    ).toContain("Scarlet & Violet 151");

    expect(
      getPokePricesSetNameCandidates({
        setName: "ポケモンカード151",
        tcgDexSetId: "SV2a",
      }),
    ).toContain("Scarlet & Violet 151");
  });

  it("does not use English PokePrices pages for Asian-language cards", () => {
    expect(shouldUsePokePricesForCard({ language: "ja" })).toBe(false);
    expect(
      shouldUsePokePricesForCard(
        { language: "en" },
        { cardLanguage: "ko", languageBucket: "asian" },
      ),
    ).toBe(false);
    expect(shouldUsePokePricesForCard({ language: "en" })).toBe(true);
  });

  it("extracts public metadata prices from PokePrices HTML", () => {
    const html = `
      <title>Blaziken VMAX #TG15: Is It Worth Grading? $115 PSA 10 vs $32 Raw (2026)</title>
      <meta name="description" content="PSA 10 $115 is 3.6x the raw price of $32." />
    `;

    expect(parsePokePricesHtml(html)).toEqual({
      rawUsd: 32,
      psa9Usd: undefined,
      psa10Usd: 115,
    });
  });

  it("extracts embedded cent values when the rendered data is present", () => {
    const html = `{"raw_usd":3189,"psa9_usd":3463,"psa10_usd":11548}`;

    expect(parsePokePricesHtml(html)).toEqual({
      rawUsd: 31.89,
      psa9Usd: 34.63,
      psa10Usd: 115.48,
    });
  });
});
