import { describe, expect, it } from "vitest";
import {
  buildCardmarketArticlesApiUrl,
  buildCardmarketSearchQuery,
  buildCardmarketSearchUrl,
} from "./cardmarket-url";

describe("Cardmarket URL builder", () => {
  it("builds search terms with Cardmarket set abbreviations", () => {
    expect(
      buildCardmarketSearchQuery({
        cardNumber: "1/106",
        name: "Blaziken",
        setId: "ex9",
      }),
    ).toBe("Blaziken EM 1");

    expect(
      buildCardmarketSearchQuery({
        cardNumber: "1/5",
        name: "Pikachu on the Ball",
        setId: "fut2020",
      }),
    ).toBe("Pikachu on the Ball FUT20 1");
  });

  it("uses Japanese set code and number when the card name is not latin", () => {
    expect(
      buildCardmarketSearchQuery({
        cardNumber: "201/165",
        id: "SV2a-201",
        name: "リザードンex",
        setId: "SV2a",
      }),
    ).toBe("SV2a 201");
  });

  it("creates a Cardmarket search URL", () => {
    expect(
      buildCardmarketSearchUrl({
        cardNumber: "TG15/195",
        name: "Blaziken VMAX",
        setId: "swsh12tg",
      }),
    ).toBe(
      "https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=Blaziken%20VMAX%20SIT%20TG15",
    );
  });

  it("adds Cardmarket language and min-condition filters", () => {
    expect(
      buildCardmarketSearchUrl(
        {
          cardNumber: "175/165",
          name: "Psyduck",
          setId: "SV2a",
        },
        {
          language: "ja",
          minCondition: "MT",
        },
      ),
    ).toBe(
      "https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=SV2a%20175&language=7&minCondition=1",
    );
  });

  it("keeps western names in filtered Cardmarket search terms", () => {
    expect(
      buildCardmarketSearchUrl(
        {
          cardNumber: "TG15/195",
          name: "Blaziken VMAX",
          setId: "swsh12tg",
        },
        {
          language: "en",
          minCondition: "NM",
        },
      ),
    ).toBe(
      "https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=Blaziken%20VMAX%20SIT%20TG15&language=1&minCondition=2",
    );
  });

  it("maps Near Mint to Cardmarket minCondition 2", () => {
    expect(
      buildCardmarketSearchUrl(
        {
          cardNumber: "062",
          name: "Meowth ex",
          setId: "sv08",
        },
        {
          language: "en",
          minCondition: "NM",
        },
      ),
    ).toContain("language=1&minCondition=2");
  });

  it("uses Cardmarket API article filter codes for filtered pricing", () => {
    expect(
      buildCardmarketArticlesApiUrl(719496, {
        language: "ja",
        minCondition: "NM",
      }),
    ).toBe(
      "https://apiv2.cardmarket.com/ws/v2.0/articles/719496?maxResults=10&start=0&idLanguage=7&minCondition=NM",
    );
  });
});
