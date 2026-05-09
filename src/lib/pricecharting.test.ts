import { describe, expect, it } from "vitest";
import {
  buildPriceChartingSearchUrl,
  buildPriceChartingUrls,
  parsePriceChartingHtml,
  selectPriceChartingSearchCandidateUrl,
} from "./pricecharting";

describe("PriceCharting parser", () => {
  it("uses language-specific PriceCharting pages for Asian 151 cards", () => {
    const psyduck = {
      id: "sv2a-175",
      name: "Psyduck",
      setName: "Pokemon Card 151",
      cardNumber: "175/165",
      imageUrl: "",
      language: "ja",
      source: "tcgdex" as const,
      tcgDexSetId: "sv2a",
    };

    expect(buildPriceChartingUrls(psyduck, { cardLanguage: "ja" })[0]).toBe(
      "https://www.pricecharting.com/game/pokemon-japanese-scarlet-&-violet-151/psyduck-175",
    );
    expect(buildPriceChartingUrls(psyduck, { cardLanguage: "ko" })[0]).toBe(
      "https://www.pricecharting.com/game/pokemon-korean-scarlet-&-violet-151/psyduck-175",
    );
  });

  it("uses PriceCharting search for Japanese cards without an English name", () => {
    const japanesePsyduck = {
      id: "SV2a-175",
      name: "コダック",
      setName: "ポケモンカード151",
      cardNumber: "175/165",
      imageUrl: "",
      language: "ja",
      source: "tcgdex" as const,
      tcgDexSetId: "SV2a",
    };

    expect(buildPriceChartingUrls(japanesePsyduck, { cardLanguage: "ja" })).toEqual([]);
    expect(buildPriceChartingSearchUrl(japanesePsyduck)).toBe(
      "https://www.pricecharting.com/search-products?q=sv2a%20175&type=prices",
    );

    const html = `
      <a href="https://www.pricecharting.com/game/pokemon-japanese-scarlet-&amp;-violet-151/psyduck-175">Psyduck #175</a>
      <a href="https://www.pricecharting.com/game/pokemon-korean-scarlet-&amp;-violet-151/psyduck-175">Psyduck #175</a>
    `;

    expect(
      selectPriceChartingSearchCandidateUrl(html, japanesePsyduck, {
        cardLanguage: "ja",
      }),
    ).toBe(
      "https://www.pricecharting.com/game/pokemon-japanese-scarlet-&-violet-151/psyduck-175",
    );
  });

  it("does not build direct URLs from suffix-only Japanese card names", () => {
    const japaneseUmbreon = {
      id: "SV8a-217",
      name: "ブラッキーex",
      setName: "テラスタルフェスex",
      cardNumber: "217/187",
      imageUrl: "",
      language: "ja",
      source: "tcgdex" as const,
      tcgDexSetId: "SV8a",
    };

    expect(buildPriceChartingUrls(japaneseUmbreon, { cardLanguage: "ja" })).toEqual([]);
    expect(buildPriceChartingSearchUrl(japaneseUmbreon)).toBe(
      "https://www.pricecharting.com/search-products?q=sv8a%20217&type=prices",
    );

    const html = `
      <a href="https://www.pricecharting.com/game/pokemon-japanese-terastal-festival/umbreon-ex-217">Umbreon Ex #217</a>
      <a href="https://www.pricecharting.com/game/pokemon-korean-terastal-festival-ex/umbreon-ex-217">Umbreon Ex #217</a>
    `;

    expect(
      selectPriceChartingSearchCandidateUrl(html, japaneseUmbreon, {
        cardLanguage: "ja",
      }),
    ).toBe(
      "https://www.pricecharting.com/game/pokemon-japanese-terastal-festival/umbreon-ex-217",
    );
  });

  it("keeps English PriceCharting pages for western cards", () => {
    expect(
      buildPriceChartingUrls({
        id: "swsh7-215",
        name: "Umbreon VMAX",
        setName: "Evolving Skies",
        cardNumber: "215/203",
        imageUrl: "",
        language: "en",
        source: "tcgdex",
        tcgDexSetId: "swsh7",
      })[0],
    ).toBe(
      "https://www.pricecharting.com/game/pokemon-evolving-skies/umbreon-vmax-215",
    );
  });

  it("extracts raw, PSA 7, PSA 8, PSA 9, PSA 9.5, and PSA 10 prices", () => {
    const html = `
      <td id="used_price"><span class="price js-price">$55.00</span></td>
      <td id="complete_price"><span class="price js-price">$61.25</span></td>
      <td id="new_price"><span class="price js-price">$68.50</span></td>
      <td id="graded_price" class="tablet-portrait-hidden">
        <span class="price js-price">$72.67</span>
      </td>
      <td id="box_only_price" class="tablet-portrait-hidden">
        <span class="price js-price">$96.10</span>
      </td>
      <td id="manual_only_price" class="tablet-portrait-hidden">
        <span class="price js-price">$353.65</span>
      </td>
    `;

    expect(parsePriceChartingHtml(html)).toEqual({
      rawUsd: 55,
      psa7Usd: 61.25,
      psa8Usd: 68.5,
      psa9Usd: 72.67,
      psa95Usd: 96.1,
      psa10Usd: 353.65,
    });
  });

  it("falls back to class-only Grade 7 cells from search/table markup", () => {
    const html = `
      <td class="price numeric used_price"><span class="js-price">$19.99</span></td>
      <td class="price numeric cib_price"><span class="js-price">$24.50</span></td>
      <td class="price numeric new_price"><span class="js-price">$31.75</span></td>
    `;

    expect(parsePriceChartingHtml(html)).toMatchObject({
      rawUsd: 19.99,
      psa7Usd: 24.5,
      psa8Usd: 31.75,
    });
  });

  it("does not read through blank cells into the next grade price", () => {
    const html = `
      <td id="complete_price"><span class="price js-price">-</span></td>
      <td id="new_price"><span class="price js-price">-</span></td>
      <td id="graded_price"><span class="price js-price">$29.89</span></td>
    `;

    expect(parsePriceChartingHtml(html)).toMatchObject({
      psa7Usd: undefined,
      psa8Usd: undefined,
      psa9Usd: 29.89,
    });
  });
});
