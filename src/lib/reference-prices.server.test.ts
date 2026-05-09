import { describe, expect, it } from "vitest";
import {
  mergeReferenceValues,
  mergeSourceUrls,
  selectRawReferenceDkk,
  selectTcgDexCardmarketEur,
} from "./reference-prices.server";

describe("reference price merging", () => {
  it("keeps Cardmarket raw when it is plausible", () => {
    expect(
      selectRawReferenceDkk([
        { rawDkk: 170, sources: ["cardmarket"] },
        { rawDkk: 210, sources: ["pokeprices"] },
      ]),
    ).toBe(170);
  });

  it("keeps Cardmarket raw even when PokePrices is much higher", () => {
    expect(
      selectRawReferenceDkk([
        { rawDkk: 19, sources: ["cardmarket"] },
        { rawDkk: 2908, sources: ["pokeprices"] },
      ]),
    ).toBe(19);
  });

  it("does not inflate true low-value cards when the alternate is also low", () => {
    expect(
      selectRawReferenceDkk([
        { rawDkk: 8, sources: ["cardmarket"] },
        { rawDkk: 24, sources: ["pokeprices"] },
      ]),
    ).toBe(8);
  });

  it("preserves the first URL for a source when merging fallbacks", () => {
    expect(
      mergeSourceUrls([
        {
          sources: ["cardmarket"],
          sourceUrls: { cardmarket: "https://cardmarket.example/first" },
        },
        {
          sources: ["cardmarket", "pokeprices"],
          sourceUrls: {
            cardmarket: "https://cardmarket.example/fallback",
            pokeprices: "https://pokeprices.example/card",
          },
        },
      ]),
    ).toEqual({
      cardmarket: "https://cardmarket.example/first",
      pokeprices: "https://pokeprices.example/card",
    });
  });

  it("does not reuse aggregate raw prices as filtered Cardmarket values", () => {
    expect(
      mergeReferenceValues(
        [
          {
            rawDkk: undefined,
            rawFilterStatus: "filtered_unavailable",
            rawPriceNote: "Filtered Cardmarket price unavailable.",
            rawSource: "cardmarket",
            sources: ["cardmarket"],
            sourceUrls: {
              cardmarket:
                "https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=Test&language=7&minCondition=2",
            },
          },
          {
            rawDkk: 250,
            rawSource: "tcgplayer",
            sources: ["tcgplayer"],
          },
        ],
        { requireFilteredRaw: true },
      ),
    ).toMatchObject({
      rawDkk: undefined,
      rawFilterStatus: "filtered_unavailable",
      rawSource: "cardmarket",
      sourceUrls: {
        cardmarket:
          "https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=Test&language=7&minCondition=2",
      },
    });
  });

  it("uses a filtered Cardmarket value when one exists", () => {
    expect(
      mergeReferenceValues(
        [
          {
            rawDkk: 123,
            rawFilterStatus: "filtered",
            rawSource: "cardmarket",
            sources: ["cardmarket"],
          },
          {
            rawDkk: 999,
            rawSource: "tcgplayer",
            sources: ["tcgplayer"],
          },
        ],
        { requireFilteredRaw: true },
      ).rawDkk,
    ).toBe(123);
  });

  it("prefers live filtered Cardmarket raw over aggregate Cardmarket raw", () => {
    expect(
      mergeReferenceValues([
        {
          rawDkk: 180,
          rawFilterStatus: "live_filtered",
          rawSource: "cardmarket",
          sources: ["cardmarket"],
        },
        {
          rawDkk: 95,
          rawFilterStatus: "aggregate",
          rawSource: "cardmarket",
          sources: ["cardmarket"],
        },
      ]),
    ).toMatchObject({
      rawDkk: 180,
      rawFilterStatus: "live_filtered",
      rawSource: "cardmarket",
    });
  });

  it("keeps TCGdex Cardmarket aggregate raw when filtered listings are unavailable", () => {
    expect(
      mergeReferenceValues([
        {
          rawDkk: 95,
          rawFilterStatus: "aggregate",
          rawPriceNote: "Using TCGdex Cardmarket aggregate.",
          rawSource: "cardmarket",
          sources: ["cardmarket"],
        },
        {
          rawDkk: 250,
          rawSource: "tcgplayer",
          sources: ["tcgplayer"],
        },
      ]),
    ).toMatchObject({
      rawDkk: 95,
      rawFilterStatus: "aggregate",
      rawSource: "cardmarket",
    });
  });
});

describe("TCGdex Cardmarket pricing", () => {
  it("corrects Japanese SV secret ex prices that are off by two decimals", () => {
    expect(
      selectTcgDexCardmarketEur({
        id: "SV2a-201",
        localId: "201",
        name: "リザードンex",
        pricing: {
          cardmarket: {
            avg: 1.56,
            avg7: 1.33,
            avg30: 1.56,
            trend: 2.53,
          },
        },
        set: {
          cardCount: { official: 165, total: 210 },
          id: "SV2a",
          name: "ポケモンカード151",
        },
      }),
    ).toBe(253);
  });

  it("does not scale Japanese cards that use holo pricing", () => {
    expect(
      selectTcgDexCardmarketEur({
        id: "SV2a-177",
        localId: "177",
        name: "ゴーリキー",
        pricing: {
          cardmarket: {
            avg: 0.45,
            avg7: 0.8,
            avg30: 0.38,
            "avg-holo": 2.39,
            "trend-holo": 3.62,
            trend: 0.27,
          },
        },
        set: {
          cardCount: { official: 165, total: 210 },
          id: "SV2a",
          name: "ポケモンカード151",
        },
      }),
    ).toBe(3.62);
  });

  it("uses holo pricing for Japanese illustration rares with tiny non-holo values", () => {
    expect(
      selectTcgDexCardmarketEur({
        id: "SV2a-175",
        localId: "175",
        name: "コダック",
        pricing: {
          cardmarket: {
            avg: 1.24,
            low: 0.02,
            trend: 0.06,
            avg1: 0.06,
            avg7: 0.05,
            avg30: 0.07,
            "avg-holo": 5.97,
            "low-holo": 0.03,
            "trend-holo": 12.68,
            "avg1-holo": 40,
            "avg7-holo": 11.99,
            "avg30-holo": 5.14,
          },
        },
        set: {
          cardCount: { official: 165, total: 210 },
          id: "SV2a",
          name: "ポケモンカード151",
        },
      }),
    ).toBe(12.68);
  });
});
