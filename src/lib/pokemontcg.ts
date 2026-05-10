import type {
  ReferencePriceFilters,
  ReferenceSource,
  ReferenceValues,
} from "./calculations";
import { buildCardmarketSearchUrl } from "./cardmarket-url";
import {
  pickOrderedMarketPrice,
  pickRepresentativeMarketPrice,
} from "./market-price";
import type { CardSearchResult, ParsedCardSearchQuery } from "./tcgdex";

const POKEMON_TCG_BASE_URL = "https://api.pokemontcg.io/v2";
const USD_TO_DKK = 7;
const EUR_TO_DKK = 7.46;
const SET_CACHE_TTL_MS = 1000 * 60 * 60 * 24;
const CARD_QUERY_CACHE_TTL_MS = 1000 * 60 * 10;

type PokemonTcgSet = {
  id: string;
  name: string;
  ptcgoCode?: string;
  printedTotal?: number;
  total?: number;
};

type PokemonTcgCard = {
  id: string;
  name: string;
  number: string;
  images?: {
    small?: string;
  };
  set: PokemonTcgSet;
  tcgplayer?: {
    url?: string;
    prices?: Record<string, PokemonTcgPrice>;
  };
  cardmarket?: {
    url?: string;
    prices?: {
      averageSellPrice?: number;
      trendPrice?: number;
      avg1?: number;
      avg7?: number;
      avg30?: number;
    };
  };
};

type PokemonTcgPrice = {
  low?: number;
  mid?: number;
  high?: number;
  market?: number;
  directLow?: number;
};

let setCache: { expiresAt: number; sets: PokemonTcgSet[] } | undefined;
const cardQueryCache = new Map<
  string,
  { cards: PokemonTcgCard[]; expiresAt: number }
>();

export async function searchPokemonTcgCards(
  query: string,
  parsed: ParsedCardSearchQuery,
): Promise<CardSearchResult[]> {
  const sets =
    parsed.nameTokens.length > 0 && parsed.setAliases.length === 0
      ? await findPokemonTcgSets(query)
      : [];
  const firstNameToken = parsed.nameTokens[0] ?? "";
  const apiQueries = buildPokemonTcgQueries(firstNameToken, parsed.localId, sets);
  const settled = await Promise.allSettled(
    apiQueries.map((apiQuery) => fetchPokemonTcgCards(apiQuery)),
  );

  return settled
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .map(mapPokemonTcgCard)
    .slice(0, 40);
}

export async function fetchPokemonTcgReferenceValues(
  card: CardSearchResult,
  filters: ReferencePriceFilters = {},
): Promise<ReferenceValues> {
  if (!card.pokemonTcgId) {
    return { sources: [], fetchedAt: new Date().toISOString() };
  }

  try {
    const response = await fetch(
      `${POKEMON_TCG_BASE_URL}/cards/${encodeURIComponent(card.pokemonTcgId)}`,
    );
    if (!response.ok) {
      return { sources: [], fetchedAt: new Date().toISOString() };
    }

    const data = (await response.json()) as { data?: PokemonTcgCard };
    return mapPokemonTcgPricing(data.data, filters);
  } catch {
    return { sources: [], fetchedAt: new Date().toISOString() };
  }
}

async function findPokemonTcgSets(query: string): Promise<PokemonTcgSet[]> {
  const normalizedQuery = normalize(query);
  const sets = await fetchPokemonTcgSets();
  const matches = sets
    .map((set) => ({
      set,
      termLength: bestSetTermLength(set, normalizedQuery),
    }))
    .filter((match) => match.termLength > 0)
    .sort((a, b) => b.termLength - a.termLength)
    .map((match) => match.set);

  return dedupeSets(matches).slice(0, 4);
}

async function fetchPokemonTcgSets(): Promise<PokemonTcgSet[]> {
  if (setCache && setCache.expiresAt > Date.now()) {
    return setCache.sets;
  }

  const response = await fetch(`${POKEMON_TCG_BASE_URL}/sets?pageSize=500`);
  if (!response.ok) {
    return [];
  }

  const data = (await response.json()) as { data?: PokemonTcgSet[] };
  const sets = data.data ?? [];
  setCache = { expiresAt: Date.now() + SET_CACHE_TTL_MS, sets };
  return sets;
}

function buildPokemonTcgQueries(
  nameToken: string,
  localId: string,
  sets: PokemonTcgSet[],
): string[] {
  const queries: string[] = [];
  const cleanName = normalizeFieldValue(nameToken);
  const cleanNumber = normalizeFieldValue(localId);

  for (const set of sets) {
    if (cleanName) {
      queries.push(`name:${cleanName} set.id:${set.id}`);
    }

    if (cleanName && cleanNumber && /[a-z]/i.test(cleanNumber)) {
      queries.push(`name:${cleanName} number:${cleanNumber} set.id:${set.id}`);
    }

    if (!cleanName && cleanNumber) {
      queries.push(`number:${cleanNumber} set.id:${set.id}`);
    }
  }

  if (cleanName && cleanNumber) {
    queries.push(`name:${cleanName} number:${cleanNumber}`);
  }

  if (cleanName) {
    queries.push(`name:${cleanName}`);
  }

  return Array.from(new Set(queries)).slice(0, 10);
}

async function fetchPokemonTcgCards(query: string): Promise<PokemonTcgCard[]> {
  const cached = cardQueryCache.get(query);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.cards;
  }

  const response = await fetch(
    `${POKEMON_TCG_BASE_URL}/cards?q=${encodeURIComponent(query)}&pageSize=25`,
  );
  if (!response.ok) {
    return [];
  }

  const data = (await response.json()) as { data?: PokemonTcgCard[] };
  const cards = data.data ?? [];
  cardQueryCache.set(query, {
    cards,
    expiresAt: Date.now() + CARD_QUERY_CACHE_TTL_MS,
  });
  return cards;
}

function mapPokemonTcgCard(card: PokemonTcgCard): CardSearchResult {
  const printedTotal = card.set.printedTotal || card.set.total;
  return {
    id: `pokemontcg-${card.id}`,
    name: card.name,
    setName: card.set.name,
    cardNumber: printedTotal ? `${card.number}/${printedTotal}` : card.number,
    imageUrl: card.images?.small ?? "",
    language: "en",
    source: "pokemontcg",
    pokemonTcgId: card.id,
    pokemonTcgSetId: card.set.id,
  };
}

function mapPokemonTcgPricing(
  card: PokemonTcgCard | undefined,
  filters: ReferencePriceFilters = {},
): ReferenceValues {
  if (!card) {
    return { sources: [], fetchedAt: new Date().toISOString() };
  }

  const cardmarketValue =
    pickOrderedMarketPrice([
      card.cardmarket?.prices?.trendPrice,
      card.cardmarket?.prices?.avg7,
      card.cardmarket?.prices?.avg30,
      card.cardmarket?.prices?.averageSellPrice,
      card.cardmarket?.prices?.avg1,
    ]);
  const tcgplayerValue = bestTcgPlayerValue(card.tcgplayer?.prices);
  const wantsFilteredCardmarket = Boolean(
    filters.cardLanguage || filters.minCondition,
  );
  const usableCardmarketValue = wantsFilteredCardmarket
    ? undefined
    : cardmarketValue;
  const sources: ReferenceSource[] = [];
  const sourceUrls: ReferenceValues["sourceUrls"] = {};

  if (cardmarketValue) {
    sources.push("cardmarket");
    sourceUrls.cardmarket = buildCardmarketSearchUrl({
      cardNumber: card.number,
      id: card.id,
      name: card.name,
      setId: card.set.id,
      setName: card.set.name,
    }, {
      language: filters.cardLanguage,
      minCondition: filters.minCondition,
    });
  }

  if (tcgplayerValue) {
    sources.push("tcgplayer");
    sourceUrls.tcgplayer = card.tcgplayer?.url;
  }

  const rawDkk = usableCardmarketValue
    ? Math.round(usableCardmarketValue * EUR_TO_DKK)
    : tcgplayerValue
      ? Math.round(tcgplayerValue * USD_TO_DKK)
      : undefined;

  return {
    rawDkk: wantsFilteredCardmarket ? undefined : rawDkk,
    rawSource: cardmarketValue
      ? "cardmarket"
      : tcgplayerValue
        ? "tcgplayer"
        : undefined,
    rawFilterStatus: wantsFilteredCardmarket
      ? "filtered_unavailable"
      : undefined,
    rawPriceNote:
      wantsFilteredCardmarket && cardmarketValue
        ? `Filtered Cardmarket price unavailable. PokemonTCG aggregate is ${Math.round(
            cardmarketValue * EUR_TO_DKK,
          )} DKK.`
        : undefined,
    sources,
    sourceUrls,
    fetchedAt: new Date().toISOString(),
  };
}

function bestTcgPlayerValue(
  prices: Record<string, PokemonTcgPrice> | undefined,
): number | undefined {
  if (!prices) {
    return undefined;
  }

  for (const price of Object.values(prices)) {
    const value = pickRepresentativeMarketPrice([
      price.market,
      price.mid,
      price.low,
      price.directLow,
    ]);
    if (value && value > 0) {
      return value;
    }
  }

  return undefined;
}

function bestSetTermLength(set: PokemonTcgSet, normalizedQuery: string): number {
  const terms = [
    set.ptcgoCode,
    set.id,
    set.name,
    set.name.replace(/^Pokémon /i, ""),
    set.name.replace(/^Pokemon /i, ""),
  ]
    .filter(Boolean)
    .map((term) => normalize(term ?? ""));

  const matched = terms.filter((term) => hasWholeTerm(normalizedQuery, term));
  return matched.reduce((max, term) => Math.max(max, term.length), 0);
}

function hasWholeTerm(value: string, term: string): boolean {
  if (!term) {
    return false;
  }

  return new RegExp(`(^|\\s)${escapeRegExp(term)}(?=\\s|$)`, "i").test(value);
}

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9.]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function normalizeFieldValue(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "");
}

function dedupeSets(sets: PokemonTcgSet[]): PokemonTcgSet[] {
  const seen = new Set<string>();
  return sets.filter((set) => {
    if (seen.has(set.id)) {
      return false;
    }

    seen.add(set.id);
    return true;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
