import type {
  ReferencePriceFilters,
  ReferenceSource,
  ReferenceValues,
} from "./calculations";
import {
  buildCardmarketArticlesApiUrl,
  buildCardmarketSearchUrl,
} from "./cardmarket-url";
import {
  pickOrderedMarketPrice,
  pickRepresentativeMarketPrice,
  pickVariantMarketPrice,
} from "./market-price";
import { fetchCardmarketLiveReferenceValues } from "./cardmarket-live";
import { fetchPokemonTcgReferenceValues } from "./pokemontcg";
import { fetchPokePricesReferenceValues } from "./pokeprices";
import { fetchPriceChartingReferenceValues } from "./pricecharting";
import type { CardSearchResult } from "./tcgdex";

const TCGDEX_BASE_URL = "https://api.tcgdex.net/v2";
const EUR_TO_DKK = 7.46;
const USD_TO_DKK = 7;

type TcgDexPricing = {
  id?: string;
  localId?: string;
  name?: string;
  pricing?: {
    cardmarket?: {
      unit?: "EUR";
      idProduct?: number;
      avg?: number;
      low?: number;
      trend?: number;
      avg1?: number;
      avg7?: number;
      avg30?: number;
      "avg-holo"?: number;
      "low-holo"?: number;
      "trend-holo"?: number;
      "avg1-holo"?: number;
      "avg7-holo"?: number;
      "avg30-holo"?: number;
    };
    tcgplayer?: TcgPlayerPricing;
  };
  set?: {
    cardCount?: {
      official?: number;
      total?: number;
    };
    id?: string;
    name?: string;
  };
};

type CardmarketArticlesResponse = {
  article?: CardmarketArticle | CardmarketArticle[];
  articles?: CardmarketArticle[];
};

type CardmarketArticle = {
  price?: number | string;
  priceEUR?: number | string;
  price_eur?: number | string;
};

type TcgPlayerPricing = {
  unit?: "USD";
  normal?: TcgPlayerVariant;
  holo?: TcgPlayerVariant;
  reverse?: TcgPlayerVariant;
};

type TcgPlayerVariant = {
  lowPrice?: number;
  midPrice?: number;
  highPrice?: number;
  marketPrice?: number;
  directLowPrice?: number;
};

export async function fetchReferencePricesServer(
  card: CardSearchResult,
  filters: ReferencePriceFilters = {},
): Promise<ReferenceValues> {
  const [cardmarketLive, tcgdex, pokemonTcg, pokeprices] = await Promise.allSettled([
    fetchCardmarketLiveReferenceValues(card, filters),
    fetchTcgDexReferenceValues(card, filters),
    fetchPokemonTcgReferenceValues(card, filters),
    fetchPokePricesReferenceValues(card, filters),
  ]);

  const baseValues = [
    cardmarketLive.status === "fulfilled" ? cardmarketLive.value : emptyValues(),
    tcgdex.status === "fulfilled" ? tcgdex.value : emptyValues(),
    pokemonTcg.status === "fulfilled" ? pokemonTcg.value : emptyValues(),
    pokeprices.status === "fulfilled" ? pokeprices.value : emptyValues(),
  ];
  const merged = mergeReferenceValues(baseValues);

  if (merged.psa7Dkk && merged.psa8Dkk && merged.psa9Dkk && merged.psa10Dkk) {
    return merged;
  }

  const pricecharting = await fetchPriceChartingReferenceValues(card, filters);
  return mergeReferenceValues([...baseValues, pricecharting]);
}

async function fetchTcgDexReferenceValues(
  card: CardSearchResult,
  filters: ReferencePriceFilters,
): Promise<ReferenceValues> {
  const languages = [
    filters.cardLanguage ?? "",
    card.language || "en",
    "en",
  ].filter(
    (language, index, all) => language && all.indexOf(language) === index,
  );

  for (const language of languages) {
    try {
      const response = await fetch(
        `${TCGDEX_BASE_URL}/${language}/cards/${encodeURIComponent(card.id)}`,
      );
      if (!response.ok) {
        continue;
      }

      const detail = (await response.json()) as TcgDexPricing;
      const values = await mapTcgDexPricing(detail, filters);
      if (values.rawDkk || values.sources.length > 0) {
        return values;
      }
    } catch {
      // Try the next language fallback. The UI stays usable if all fail.
    }
  }

  return emptyValues();
}

async function mapTcgDexPricing(
  detail: TcgDexPricing,
  filters: ReferencePriceFilters,
): Promise<ReferenceValues> {
  const sources: ReferenceSource[] = [];
  const sourceUrls: ReferenceValues["sourceUrls"] = {};
  const tcgplayer = detail.pricing?.tcgplayer;
  const filteredCardmarketValue = await fetchFilteredCardmarketEur(
    detail,
    filters,
  );
  const aggregateCardmarketValue = selectTcgDexCardmarketEur(detail);
  const tcgplayerValue = bestTcgPlayerValue(tcgplayer);
  const wantsFilteredCardmarket = hasCardmarketFilters(filters);
  const cardmarketValue = wantsFilteredCardmarket
    ? filteredCardmarketValue ?? aggregateCardmarketValue
    : aggregateCardmarketValue;
  const rawFilterStatus =
    filteredCardmarketValue !== undefined
      ? "filtered"
      : cardmarketValue
        ? "aggregate"
        : wantsFilteredCardmarket
          ? "filtered_unavailable"
          : undefined;

  if (cardmarketValue || aggregateCardmarketValue || detail.pricing?.cardmarket?.idProduct) {
    sources.push("cardmarket");
    sourceUrls.cardmarket = cardmarketUrl(detail, filters);
  }

  if (tcgplayerValue) {
    sources.push("tcgplayer");
  }

  const rawDkk = wantsFilteredCardmarket
    ? cardmarketValue
      ? cardmarketValue * EUR_TO_DKK
      : undefined
    : cardmarketValue
      ? cardmarketValue * EUR_TO_DKK
      : tcgplayerValue
        ? tcgplayerValue * USD_TO_DKK
        : undefined;

  return {
    rawDkk: rawDkk ? Math.round(rawDkk) : undefined,
    rawSource:
      cardmarketValue
        ? "cardmarket"
        : tcgplayerValue
          ? "tcgplayer"
          : undefined,
    rawFilterStatus,
    rawPriceNote: rawPriceStatusNote(rawFilterStatus, aggregateCardmarketValue),
    sources,
    sourceUrls,
    fetchedAt: new Date().toISOString(),
  };
}

export function selectTcgDexCardmarketEur(
  detail: TcgDexPricing,
): number | undefined {
  const cardmarket = detail.pricing?.cardmarket;
  const primaryValues = [
    cardmarket?.trend,
    cardmarket?.avg7,
    cardmarket?.avg30,
    cardmarket?.avg,
    cardmarket?.avg1,
  ];
  const alternateValues = [
    cardmarket?.["trend-holo"],
    cardmarket?.["avg7-holo"],
    cardmarket?.["avg30-holo"],
    cardmarket?.["avg-holo"],
    cardmarket?.["avg1-holo"],
  ];
  const primary = pickOrderedMarketPrice(primaryValues);
  const alternate = pickOrderedMarketPrice(alternateValues);
  const selected = pickVariantMarketPrice(primaryValues, alternateValues);

  if (
    selected &&
    selected === primary &&
    shouldScaleJapaneseSecretCardmarketValue(detail, selected, alternate)
  ) {
    return Math.round(selected * 100);
  }

  return selected;
}

async function fetchFilteredCardmarketEur(
  detail: TcgDexPricing,
  filters: ReferencePriceFilters,
): Promise<number | undefined> {
  const idProduct = detail.pricing?.cardmarket?.idProduct;
  if (!idProduct || !hasCardmarketFilters(filters)) {
    return undefined;
  }

  try {
    const response = await fetch(
      buildCardmarketArticlesApiUrl(idProduct, {
        language: filters.cardLanguage,
        minCondition: filters.minCondition,
      }),
      {
        cache: "no-store",
        headers: {
          accept: "application/json",
        },
      },
    );

    if (!response.ok) {
      return undefined;
    }

    const data = (await response.json()) as CardmarketArticlesResponse;
    return extractLowestCardmarketArticlePrice(data);
  } catch {
    return undefined;
  }
}

function extractLowestCardmarketArticlePrice(
  data: CardmarketArticlesResponse,
): number | undefined {
  const articles = [
    ...(Array.isArray(data.article) ? data.article : data.article ? [data.article] : []),
    ...(data.articles ?? []),
  ];
  const prices = articles
    .map((article) =>
      parseEuroNumber(article.price ?? article.priceEUR ?? article.price_eur),
    )
    .filter((price): price is number => Boolean(price));

  if (prices.length === 0) {
    return undefined;
  }

  return Math.min(...prices);
}

function parseEuroNumber(value: number | string | undefined): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }

  if (!value) {
    return undefined;
  }

  const normalized = value
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function hasCardmarketFilters(filters: ReferencePriceFilters): boolean {
  return Boolean(filters.cardLanguage || filters.minCondition);
}

function shouldScaleJapaneseSecretCardmarketValue(
  detail: TcgDexPricing,
  value: number,
  alternate: number | undefined,
): boolean {
  const localId = Number(detail.localId);
  const officialCount = detail.set?.cardCount?.official;
  const isJapaneseSvSubset = /^SV\d+[a-z]$/i.test(detail.set?.id ?? "");
  const isSecretCard =
    Number.isFinite(localId) &&
    Boolean(officialCount) &&
    localId > Number(officialCount);
  const hasExName = /\bex\b/i.test(detail.name ?? "");

  return (
    isJapaneseSvSubset &&
    isSecretCard &&
    hasExName &&
    !alternate &&
    value > 0 &&
    value < 5
  );
}

function bestTcgPlayerValue(pricing?: TcgPlayerPricing): number | undefined {
  if (!pricing) {
    return undefined;
  }

  const variants = [pricing.holo, pricing.normal, pricing.reverse].filter(Boolean);
  for (const variant of variants) {
    const value = pickRepresentativeMarketPrice([
      variant?.marketPrice,
      variant?.midPrice,
      variant?.lowPrice,
      variant?.directLowPrice,
    ]);
    if (value && value > 0) {
      return value;
    }
  }

  return undefined;
}

export function mergeReferenceValues(
  values: ReferenceValues[],
  options: { requireFilteredRaw?: boolean } = {},
): ReferenceValues {
  const raw = options.requireFilteredRaw
    ? selectFilteredRawReferenceValue(values)
    : selectReferenceValue(values, "rawDkk", [
        "cardmarket",
        "tcgplayer",
        "pokeprices",
        "pricecharting",
      ]);
  const psa7 = selectReferenceValue(values, "psa7Dkk", [
    "pricecharting",
  ]);
  const psa8 = selectReferenceValue(values, "psa8Dkk", [
    "pricecharting",
  ]);
  const psa9 = selectReferenceValue(values, "psa9Dkk", [
    "pokeprices",
    "pricecharting",
  ]);
  const psa95 = selectReferenceValue(values, "psa95Dkk", [
    "pricecharting",
  ]);
  const psa10 = selectReferenceValue(values, "psa10Dkk", [
    "pokeprices",
    "pricecharting",
  ]);
  const selectedRawMeta = values.find(
    (value) =>
      value.rawDkk === raw.value &&
      (!raw.source ||
        value.rawSource === raw.source ||
        value.sources.includes(raw.source)),
  ) ?? values.find((value) => value.rawFilterStatus);

  return {
    rawDkk: raw.value,
    psa7Dkk: psa7.value,
    psa8Dkk: psa8.value,
    psa9Dkk: psa9.value,
    psa95Dkk: psa95.value,
    psa10Dkk: psa10.value,
    rawSource: raw.source,
    rawFilterStatus: selectedRawMeta?.rawFilterStatus,
    rawPriceNote: selectedRawMeta?.rawPriceNote,
    psa7Source: psa7.source,
    psa8Source: psa8.source,
    psa9Source: psa9.source,
    psa95Source: psa95.source,
    psa10Source: psa10.source,
    sources: uniqueSources(values.flatMap((value) => value.sources)),
    sourceUrls: mergeSourceUrls(values),
    fetchedAt: new Date().toISOString(),
  };
}

function selectFilteredRawReferenceValue(
  values: ReferenceValues[],
): { source?: ReferenceSource; value?: number } {
  const filtered = values.find(
    (value) =>
      (value.rawFilterStatus === "live_filtered" ||
        value.rawFilterStatus === "filtered") &&
      value.rawDkk,
  );

  if (filtered?.rawDkk) {
    return { source: filtered.rawSource ?? "cardmarket", value: filtered.rawDkk };
  }

  const unavailable = values.find(
    (value) =>
      value.rawFilterStatus === "filtered_unavailable" &&
      value.sources.includes("cardmarket"),
  );

  return unavailable ? { source: "cardmarket" } : {};
}

function rawPriceStatusNote(
  status: ReferenceValues["rawFilterStatus"],
  aggregateCardmarketValue: number | undefined,
): string | undefined {
  if (status === "live_filtered") {
    return "Lowest live Cardmarket listing for the selected language and condition.";
  }

  if (status === "aggregate" && aggregateCardmarketValue) {
    return "Using TCGdex Cardmarket aggregate. Language and condition only apply when opening Cardmarket.";
  }

  if (status !== "filtered_unavailable") {
    return undefined;
  }

  const aggregateDkk = aggregateCardmarketValue
    ? Math.round(aggregateCardmarketValue * EUR_TO_DKK)
    : undefined;

  return aggregateDkk
    ? `Filtered Cardmarket price unavailable. TCGdex aggregate is ${aggregateDkk} DKK.`
    : "Filtered Cardmarket price unavailable.";
}

export function selectRawReferenceDkk(
  values: Pick<ReferenceValues, "rawDkk" | "sources" | "rawSource">[],
): number | undefined {
  return selectReferenceValue(values, "rawDkk", [
    "cardmarket",
    "tcgplayer",
    "pokeprices",
    "pricecharting",
  ]).value;
}

function selectReferenceValue<
  T extends "rawDkk" | "psa7Dkk" | "psa8Dkk" | "psa9Dkk" | "psa95Dkk" | "psa10Dkk",
>(
  values: Array<Pick<ReferenceValues, T | "sources">>,
  key: T,
  priority: ReferenceSource[],
): { source?: ReferenceSource; value?: number } {
  for (const source of priority) {
    const match = values.find(
      (value) => value[key] && value.sources.includes(source),
    );
    if (match?.[key]) {
      return { source, value: match[key] as number };
    }
  }

  const fallback = values.find((value) => value[key]);
  return { value: fallback?.[key] as number | undefined };
}

function emptyValues(): ReferenceValues {
  return {
    sources: [],
    fetchedAt: new Date().toISOString(),
  };
}

function uniqueSources(sources: ReferenceSource[]): ReferenceSource[] {
  return Array.from(new Set(sources));
}

export function mergeSourceUrls(values: ReferenceValues[]): ReferenceValues["sourceUrls"] {
  const merged: ReferenceValues["sourceUrls"] = {};

  for (const value of values) {
    for (const [source, url] of Object.entries(value.sourceUrls ?? {}) as Array<
      [ReferenceSource, string]
    >) {
      if (!merged[source]) {
        merged[source] = url;
      }
    }
  }

  return merged;
}

function cardmarketUrl(
  detail: TcgDexPricing,
  filters: ReferencePriceFilters = {},
): string {
  return buildCardmarketSearchUrl({
    cardNumber: detail.localId,
    id: detail.id,
    idProduct: detail.pricing?.cardmarket?.idProduct,
    name: detail.name,
    setId: detail.set?.id,
    setName: detail.set?.name,
  }, {
    language: filters.cardLanguage,
    minCondition: filters.minCondition,
  });
}
