import { describe, expect, it } from "vitest";
import {
  buildCardmarketLivePriceRequest,
  mapCardmarketLiveResponseToReferenceValues,
} from "./cardmarket-live";

describe("Cardmarket live price adapter", () => {
  it("builds a filtered Japanese Cardmarket sidecar request", () => {
    expect(
      buildCardmarketLivePriceRequest(
        {
          cardNumber: "175/165",
          id: "SV2a-175",
          imageUrl: "",
          language: "ja",
          name: "Psyduck",
          setName: "Pokemon Card 151",
          tcgDexSetId: "SV2a",
        },
        {
          cardLanguage: "ja",
          minCondition: "NM",
        },
      ),
    ).toMatchObject({
      cardName: "Psyduck",
      cardNumber: "175/165",
      language: "ja",
      languageId: 7,
      minCondition: "NM",
      minConditionId: 2,
      query: "SV2a 175",
      searchUrl:
        "https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=SV2a%20175&language=7&minCondition=2",
      setId: "SV2a",
    });
  });

  it("maps the lowest live EUR listing to a filtered DKK raw value", () => {
    expect(
      mapCardmarketLiveResponseToReferenceValues(
        {
          listingCount: 3,
          condition: "NM",
          exactConditionListingCount: 2,
          exactConditionMatched: true,
          ok: true,
          productUrl:
            "https://www.cardmarket.com/en/Pokemon/Products/Singles/Pokemon-Card-151/Psyduck-V4-SV2a175?language=7&minCondition=2",
          requestedCondition: "NM",
          rawEur: 12.68,
        },
        "https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=SV2a%20175",
        "NM",
      ),
    ).toMatchObject({
      rawDkk: 95,
      rawFilterStatus: "live_filtered",
      rawPriceNote:
        "Lowest live Cardmarket Near Mint listing. (2 exact-condition listings; 3 matching listings).",
      rawSource: "cardmarket",
      sources: ["cardmarket"],
      sourceUrls: {
        cardmarket:
          "https://www.cardmarket.com/en/Pokemon/Products/Singles/Pokemon-Card-151/Psyduck-V4-SV2a175?language=7&minCondition=2",
      },
    });
  });

  it("warns when Cardmarket returns a better condition than the selected raw condition", () => {
    expect(
      mapCardmarketLiveResponseToReferenceValues(
        {
          condition: "GD",
          listingCount: 5,
          ok: true,
          productUrl:
            "https://www.cardmarket.com/en/Pokemon/Products/Singles/Test?language=7&minCondition=5",
          requestedCondition: "LP",
          rawEur: 10,
        },
        "https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=Test",
        "LP",
      ),
    ).toMatchObject({
      rawDkk: 75,
      rawFilterStatus: "live_filtered",
      rawPriceNote:
        "Condition mismatch: cheapest live listing is Good, not Light Played. Cardmarket filters by minimum condition, so treat this as an upper-bound reference.",
    });
  });

  it("returns no raw value when the sidecar has no matching listing", () => {
    expect(
      mapCardmarketLiveResponseToReferenceValues(
        {
          error: "No matching listings found.",
          ok: false,
        },
        "https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=SV2a%20175",
      ),
    ).toMatchObject({
      sources: [],
    });
  });
});
