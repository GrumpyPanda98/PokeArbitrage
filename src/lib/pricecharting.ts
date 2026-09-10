import type {
  CardLanguage,
  ReferencePriceFilters,
  ReferenceValues,
} from "./calculations";
import {
  buildPokePricesCardSlug,
  getPokePricesSetNameCandidates,
} from "./pokeprices";
import type { CardSearchResult } from "./tcgdex";

const USD_TO_DKK = 7;
const PRICECHARTING_BASE_URL = "https://www.pricecharting.com";

type PriceChartingUsdValues = {
  rawUsd?: number;
  psa7Usd?: number;
  psa8Usd?: number;
  psa9Usd?: number;
  psa95Usd?: number;
  psa10Usd?: number;
  sourceUrl?: string;
};

export async function fetchPriceChartingReferenceValues(
  card: CardSearchResult,
  filters: ReferencePriceFilters = {},
): Promise<ReferenceValues> {
  const values = await fetchPriceChartingValues(card, filters);
  const hasValues = Boolean(
    values.rawUsd ||
      values.psa7Usd ||
      values.psa8Usd ||
      values.psa9Usd ||
      values.psa95Usd ||
      values.psa10Usd,
  );

  return {
    rawDkk: values.rawUsd ? Math.round(values.rawUsd * USD_TO_DKK) : undefined,
    psa7Dkk: values.psa7Usd ? Math.round(values.psa7Usd * USD_TO_DKK) : undefined,
    psa8Dkk: values.psa8Usd ? Math.round(values.psa8Usd * USD_TO_DKK) : undefined,
    psa9Dkk: values.psa9Usd ? Math.round(values.psa9Usd * USD_TO_DKK) : undefined,
    psa95Dkk: values.psa95Usd
      ? Math.round(values.psa95Usd * USD_TO_DKK)
      : undefined,
    psa10Dkk: values.psa10Usd
      ? Math.round(values.psa10Usd * USD_TO_DKK)
      : undefined,
    rawSource: values.rawUsd ? "pricecharting" : undefined,
    psa7Source: values.psa7Usd ? "pricecharting" : undefined,
    psa8Source: values.psa8Usd ? "pricecharting" : undefined,
    psa9Source: values.psa9Usd ? "pricecharting" : undefined,
    psa95Source: values.psa95Usd ? "pricecharting" : undefined,
    psa10Source: values.psa10Usd ? "pricecharting" : undefined,
    sources: hasValues ? ["pricecharting"] : [],
    sourceUrls: values.sourceUrl ? { pricecharting: values.sourceUrl } : {},
    fetchedAt: new Date().toISOString(),
  };
}

export function parsePriceChartingHtml(html: string): PriceChartingUsdValues {
  return {
    rawUsd: parsePriceCell(html, "used_price"),
    psa7Usd: parsePriceCell(html, "complete_price") ?? parsePriceCell(html, "cib_price"),
    psa8Usd: parsePriceCell(html, "new_price"),
    psa9Usd: parsePriceCell(html, "graded_price"),
    psa95Usd: parsePriceCell(html, "box_only_price"),
    psa10Usd: parsePriceCell(html, "manual_only_price"),
  };
}

async function fetchPriceChartingValues(
  card: CardSearchResult,
  filters: ReferencePriceFilters = {},
): Promise<PriceChartingUsdValues> {
  const candidates = buildPriceChartingUrls(card, filters);

  for (const url of candidates) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "CardScope research prototype",
        },
      });
      if (!response.ok) {
        continue;
      }

      const values = parsePriceChartingHtml(await response.text());
      if (
        values.rawUsd ||
        values.psa7Usd ||
        values.psa8Usd ||
        values.psa9Usd ||
        values.psa95Usd ||
        values.psa10Usd
      ) {
        return { ...values, sourceUrl: url };
      }
    } catch {
      // PriceCharting is only a fallback. Keep the app usable.
    }
  }

  const searchUrl = await fetchPriceChartingSearchCandidateUrl(card, filters);
  if (searchUrl) {
    try {
      const response = await fetch(searchUrl, {
        headers: {
          "user-agent": "CardScope research prototype",
        },
      });
      if (response.ok) {
        const values = parsePriceChartingHtml(await response.text());
        if (
          values.rawUsd ||
          values.psa7Usd ||
          values.psa8Usd ||
          values.psa9Usd ||
          values.psa95Usd ||
          values.psa10Usd
        ) {
          return { ...values, sourceUrl: searchUrl };
        }
      }
    } catch {
      // PriceCharting search is only a fallback.
    }
  }

  return {};
}

export function buildPriceChartingUrls(
  card: CardSearchResult,
  filters: ReferencePriceFilters = {},
): string[] {
  const cardSlug = buildPokePricesCardSlug(card);
  if (!cardSlug) {
    return [];
  }

  if (
    isAsianLanguage(selectedLanguage(card, filters)) &&
    !hasMeaningfulAsciiName(card.name)
  ) {
    return [];
  }

  return getPriceChartingSetNameCandidates(card, filters).map((setName) => {
    const setSlug = priceChartingSetSlug(setName);
    return `${PRICECHARTING_BASE_URL}/game/${setSlug}/${cardSlug}`;
  });
}

export function buildPriceChartingSearchUrl(card: CardSearchResult): string {
  const setId = normalizeSetId(card.tcgDexSetId ?? card.pokemonTcgSetId ?? "");
  const name = hasMeaningfulAsciiName(card.name) ? card.name : "";
  const collector = normalizeCollector(card.cardNumber);
  const query = [setId, name, collector].filter(Boolean).join(" ");
  return `${PRICECHARTING_BASE_URL}/search-products?q=${encodeURIComponent(
    query,
  )}&type=prices`;
}

async function fetchPriceChartingSearchCandidateUrl(
  card: CardSearchResult,
  filters: ReferencePriceFilters = {},
): Promise<string | undefined> {
  if (!isAsianLanguage(selectedLanguage(card, filters))) {
    return undefined;
  }

  try {
    const response = await fetch(buildPriceChartingSearchUrl(card), {
      headers: {
        "user-agent": "CardScope research prototype",
      },
    });
    if (!response.ok) {
      return undefined;
    }

    return selectPriceChartingSearchCandidateUrl(
      await response.text(),
      card,
      filters,
    );
  } catch {
    return undefined;
  }
}

export function selectPriceChartingSearchCandidateUrl(
  html: string,
  card: CardSearchResult,
  filters: ReferencePriceFilters = {},
): string | undefined {
  const candidates = uniqueStrings(
    Array.from(html.matchAll(/href=["']([^"']*\/game\/[^"']+)["']/gi)).map(
      (match) => decodeHtml(match[1] ?? ""),
    ),
  )
    .map((url) => ({
      score: scorePriceChartingSearchUrl(url, card, filters),
      url,
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);

  return candidates[0] && candidates[0].score >= 130
    ? candidates[0].url
    : undefined;
}

function scorePriceChartingSearchUrl(
  url: string,
  card: CardSearchResult,
  filters: ReferencePriceFilters,
): number {
  const language = selectedLanguage(card, filters);
  const languageSegment = priceChartingLanguageUrlSegment(language);
  const normalizedUrl = url.toLowerCase();
  const cardSlug = normalizedUrl.split("/").pop() ?? "";
  const collector = normalizeCollector(card.cardNumber);
  let score = 0;

  if (languageSegment && normalizedUrl.includes(languageSegment)) {
    score += 100;
  } else if (
    normalizedUrl.includes("pokemon-japanese-") ||
    normalizedUrl.includes("pokemon-korean-") ||
    normalizedUrl.includes("pokemon-chinese-")
  ) {
    score -= 80;
  }

  if (collector && (cardSlug === collector || cardSlug.endsWith(`-${collector}`))) {
    score += 50;
  }

  for (const token of asciiNameTokens(card.name)) {
    if (token.length > 1 && cardSlug.includes(token)) {
      score += 10;
    }
  }

  return score;
}

function getPriceChartingSetNameCandidates(
  card: CardSearchResult,
  filters: ReferencePriceFilters = {},
): string[] {
  const language = selectedLanguage(card, filters);
  const asianSetName = asianPriceChartingSetName(card, language);
  if (asianSetName) {
    return [asianSetName];
  }

  if (filters.languageBucket === "asian" || isAsianLanguage(language)) {
    return [];
  }

  return getPokePricesSetNameCandidates(card);
}

function asianPriceChartingSetName(
  card: CardSearchResult,
  language: CardLanguage | undefined,
): string | undefined {
  if (!isAsianLanguage(language)) {
    return undefined;
  }

  const baseSetName = asianPriceChartingBaseSetName(card, language);
  if (!baseSetName) {
    return undefined;
  }

  return `${priceChartingLanguagePrefix(language)} ${baseSetName}`;
}

function asianPriceChartingBaseSetName(
  card: CardSearchResult,
  language: CardLanguage,
): string | undefined {
  const setId = normalizeSetId(card.tcgDexSetId ?? card.pokemonTcgSetId ?? "");
  const known: Record<string, string> = {
    "sv03.5": "Scarlet & Violet 151",
    "sv04.5": "Shiny Treasure ex",
    "sv08.5": terastalFestivalSetName(language),
    sv2a: "Scarlet & Violet 151",
    sv4a: "Shiny Treasure ex",
    sv8a: terastalFestivalSetName(language),
  };

  return known[setId];
}

function selectedLanguage(
  card: CardSearchResult,
  filters: ReferencePriceFilters,
): CardLanguage | undefined {
  return filters.cardLanguage ?? normalizeLanguage(card.language);
}

function normalizeLanguage(language: string | undefined): CardLanguage | undefined {
  const normalized = language?.toLowerCase();
  if (
    normalized === "en" ||
    normalized === "fr" ||
    normalized === "de" ||
    normalized === "es" ||
    normalized === "it" ||
    normalized === "pt" ||
    normalized === "ja" ||
    normalized === "ko" ||
    normalized === "zh-tw" ||
    normalized === "zh-cn"
  ) {
    return normalized;
  }

  return undefined;
}

function isAsianLanguage(
  language: string | undefined,
): language is Extract<CardLanguage, "ja" | "ko" | "zh-tw" | "zh-cn"> {
  return (
    language === "ja" ||
    language === "ko" ||
    language === "zh-tw" ||
    language === "zh-cn"
  );
}

function priceChartingLanguagePrefix(
  language: Extract<CardLanguage, "ja" | "ko" | "zh-tw" | "zh-cn">,
): string {
  if (language === "ja") {
    return "Japanese";
  }

  if (language === "ko") {
    return "Korean";
  }

  return "Chinese";
}

function normalizeSetId(setId: string): string {
  return setId.trim().toLowerCase();
}

function priceChartingLanguageUrlSegment(
  language: CardLanguage | undefined,
): string | undefined {
  if (language === "ja") {
    return "pokemon-japanese-";
  }

  if (language === "ko") {
    return "pokemon-korean-";
  }

  if (language === "zh-tw" || language === "zh-cn") {
    return "pokemon-chinese-";
  }

  return undefined;
}

function normalizeCollector(cardNumber: string): string {
  return (cardNumber.split("/")[0] ?? "")
    .replace(/[^a-z0-9]/gi, "")
    .replace(/^0+(?=\d)/, "")
    .toLowerCase();
}

function hasMeaningfulAsciiName(value: string): boolean {
  return asciiNameTokens(value).some(
    (token) => !["ex", "v", "vmax", "vstar", "gx"].includes(token),
  );
}

function asciiNameTokens(value: string): string[] {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function terastalFestivalSetName(language: CardLanguage): string {
  return language === "ja" ? "Terastal Festival" : "Terastal Festival ex";
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#43;/g, "+")
    .replace(/&quot;/g, '"');
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function priceChartingSetSlug(setName: string): string {
  const slug = setName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’'`]/g, "")
    .replace(/&/g, " & ")
    .replace(/[^a-z0-9&]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return `pokemon-${slug}`;
}

function parsePriceCell(html: string, id: string): number | undefined {
  const escapedId = escapeRegExp(id);
  const cellPattern = new RegExp(
    `<td[^>]+(?:id=["']${escapedId}["']|class=["'][^"']*\\b${escapedId}\\b[^"']*["'])[^>]*>([\\s\\S]*?)</td>`,
    "i",
  );
  const cell = html.match(cellPattern)?.[1];
  if (!cell) {
    return undefined;
  }

  const match = cell.match(
    /<span[^>]+class=["'][^"']*(?:price|js-price)[^"']*["'][^>]*>\s*\$([\d,.]+)/i,
  );
  if (!match?.[1]) {
    return undefined;
  }

  const parsed = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
