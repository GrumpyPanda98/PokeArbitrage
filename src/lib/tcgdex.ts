import {
  fetchTcgTrackingSet,
  mapTcgTrackingProductToCard,
} from "./tcgtracking";
import { searchPokemonTcgCards } from "./pokemontcg";
import type { CardLanguage, LanguageBucket } from "./calculations";

export type TcgDexCardBrief = {
  id: string;
  localId: string;
  name: string;
  image?: string;
};

export type TcgDexCardDetail = TcgDexCardBrief & {
  set?: {
    id?: string;
    name?: string;
    cardCount?: {
      official?: number;
      total?: number;
    };
  };
};

type TcgDexSetDetail = {
  id: string;
  name: string;
  cardCount?: {
    official?: number;
    total?: number;
  };
  cards?: TcgDexCardBrief[];
};

type SearchLanguage = CardLanguage;

type SearchOptions = {
  languageBucket?: LanguageBucket;
  preferredLanguage?: CardLanguage;
};

export type CardSearchResult = {
  id: string;
  name: string;
  setName: string;
  cardNumber: string;
  imageUrl: string;
  language: string;
  source?: "pokemontcg" | "tcgdex" | "tcgtracking";
  tcgDexSetId?: string;
  pokemonTcgId?: string;
  pokemonTcgSetId?: string;
  tcgTrackingProductId?: number;
  tcgTrackingSetId?: number;
  cardmarketId?: number;
};

export type SetAlias = {
  language: SearchLanguage;
  setId: string;
  label: string;
  tcgTrackingSetId?: number;
};

type SetAliasGroup = {
  terms: string[];
  aliases: SetAlias[];
  tcgTrackingSetIds?: number[];
};

export type ParsedCardSearchQuery = {
  cleanedQuery: string;
  localId: string;
  nameTokens: string[];
  preferredSetId: string;
  normalizedQuery: string;
  setAliases: SetAlias[];
  setToken: string;
  tcgTrackingSetIds: number[];
};

const TCGDEX_BASE_URL = "https://api.tcgdex.net/v2";
const ASIAN_SEARCH_LANGUAGES: SearchLanguage[] = ["ja", "ko", "zh-tw", "zh-cn"];
const WESTERN_SEARCH_LANGUAGES: SearchLanguage[] = ["en", "fr", "de", "es", "it", "pt"];
const SET_DETAIL_CACHE_TTL_MS = 1000 * 60 * 60 * 24;
const CARD_DETAIL_CACHE_TTL_MS = 1000 * 60 * 60 * 24;
const CARD_BRIEFS_CACHE_TTL_MS = 1000 * 60 * 10;
const setDetailCache = new Map<
  string,
  { expiresAt: number; value: TcgDexSetDetail & { language: SearchLanguage } }
>();
const cardDetailCache = new Map<
  string,
  { expiresAt: number; value: TcgDexCardDetail & { language: SearchLanguage } }
>();
const cardBriefsCache = new Map<
  string,
  {
    expiresAt: number;
    value: Array<{ card: TcgDexCardBrief; language: SearchLanguage }>;
  }
>();

const SET_ALIAS_GROUPS: SetAliasGroup[] = [
  group(["EM", "EMERALD"], [
    { language: "en", setId: "ex9", label: "Emerald" },
  ], [1410]),
  group(["EVS", "SWSH7", "SWSH07", "EVOLVING SKIES"], [
    { language: "en", setId: "swsh7", label: "Evolving Skies" },
  ], [2848]),
  group(["CRE", "CR", "SWSH6", "SWSH06", "CHILLING REIGN"], [
    { language: "en", setId: "swsh6", label: "Chilling Reign" },
  ], [2807]),
  group(["BRS", "BSTARS", "SWSH9", "SWSH09", "BRILLIANT STARS"], [
    { language: "en", setId: "swsh9", label: "Brilliant Stars" },
  ], [2948, 3020]),
  group(["BRS TG", "BRILLIANT STARS TG", "BRILLIANT STARS TRAINER GALLERY"], [
    { language: "en", setId: "swsh9", label: "Brilliant Stars" },
  ], [3020]),
  group(["ASR", "SWSH10", "ASTRAL RADIANCE"], [
    { language: "en", setId: "swsh10", label: "Astral Radiance" },
  ], [3040, 3068]),
  group(["ASR TG", "ASTRAL RADIANCE TG", "ASTRAL RADIANCE TRAINER GALLERY"], [
    { language: "en", setId: "swsh10", label: "Astral Radiance" },
  ], [3068]),
  group(["LOR", "SWSH11", "LOST ORIGIN"], [
    { language: "en", setId: "swsh11", label: "Lost Origin" },
  ], [3118, 3172]),
  group(["LOR TG", "LOST ORIGIN TG", "LOST ORIGIN TRAINER GALLERY"], [
    { language: "en", setId: "swsh11", label: "Lost Origin" },
  ], [3172]),
  group(["SIT", "SWSH12", "SILVER TEMPEST"], [
    { language: "en", setId: "swsh12", label: "Silver Tempest" },
  ], [3170, 17674]),
  group(["SIT TG", "SILVER TEMPEST TG", "SILVER TEMPEST TRAINER GALLERY"], [
    { language: "en", setId: "swsh12", label: "Silver Tempest" },
  ], [17674]),
  group(["FST", "SWSH8", "SWSH08", "FUSION STRIKE"], [
    { language: "en", setId: "swsh8", label: "Fusion Strike" },
  ], [2906]),
  group(["CRZ", "CROWN ZENITH"], [
    { language: "en", setId: "swsh12.5", label: "Crown Zenith" },
  ], [17688, 17689]),
  group(["CRZ GG", "CROWN ZENITH GG", "GALAR GALLERY", "GALARAN GALLERY", "GALARIAN GALLERY"], [
    { language: "en", setId: "swsh12.5", label: "Crown Zenith" },
  ], [17689]),
  group(["CEL", "CLB", "CELEBRATIONS"], [
    { language: "en", setId: "cel25", label: "Celebrations" },
  ], [2867, 2931]),
  group(["HIF", "HIDDEN FATES"], [
    { language: "en", setId: "sm115", label: "Hidden Fates" },
    { language: "en", setId: "sma", label: "Hidden Fates Shiny Vault" },
  ], [2480, 2594]),
  group(["HIF SV", "HIDDEN FATES SV", "HIDDEN FATES SHINY VAULT"], [
    { language: "en", setId: "sma", label: "Hidden Fates Shiny Vault" },
  ], [2594]),
  group(["CEC", "COSMIC ECLIPSE", "SM12"], [
    { language: "en", setId: "sm12", label: "Cosmic Eclipse" },
  ], [2534]),
  group(["TEU", "TEAM UP", "SM9"], [
    { language: "en", setId: "sm9", label: "Team Up" },
  ], [2377]),
  group(["FUT20", "FUT2020", "FUTSAL", "FUTSAL 2020", "POKEMON FUTSAL 2020", "POKÉMON FUTSAL 2020"], [
    { language: "en", setId: "fut2020", label: "Pokemon Futsal 2020" },
  ]),
  group(["PRE", "PRISMATIC", "PRISMATIC EVOLUTIONS"], [
    { language: "en", setId: "sv08.5", label: "Prismatic Evolutions" },
    { language: "ja", setId: "SV8a", label: "Terastal Fest ex" },
  ]),
  group(["TERASTAL", "TERASTAL FESTIVAL", "TERASTAL FEST", "SV8A"], [
    { language: "ja", setId: "SV8a", label: "Terastal Fest ex" },
  ]),
  group(["SV085", "SV08.5"], [
    { language: "en", setId: "sv08.5", label: "Prismatic Evolutions" },
  ]),
  group(["MEW", "151", "POKEMON 151", "POKÉMON 151"], [
    { language: "en", setId: "sv03.5", label: "Pokemon 151" },
    { language: "ja", setId: "SV2a", label: "Pokemon Card 151" },
  ]),
  group(["PAF", "PALDEAN FATES"], [
    { language: "en", setId: "sv04.5", label: "Paldean Fates" },
    { language: "ja", setId: "SV4a", label: "Shiny Treasure ex" },
  ]),
  group(["TWM", "TWILIGHT MASQUERADE"], [
    { language: "en", setId: "sv06", label: "Twilight Masquerade" },
  ]),
  group(["TEF", "TEMPORAL FORCES"], [
    { language: "en", setId: "sv05", label: "Temporal Forces" },
  ]),
  group(["OBF", "OBSIDIAN FLAMES"], [
    { language: "en", setId: "sv03", label: "Obsidian Flames" },
  ]),
  group(["PAL", "PALDEA EVOLVED"], [
    { language: "en", setId: "sv02", label: "Paldea Evolved" },
  ]),
  group(["SCR", "STELLAR CROWN"], [
    { language: "en", setId: "sv07", label: "Stellar Crown" },
  ]),
  group(["SSP", "SURGING SPARKS", "SV8"], [
    { language: "en", setId: "sv08", label: "Surging Sparks" },
    { language: "ja", setId: "SV8", label: "Super Electric Breaker" },
  ]),
];

export async function searchTcgDexCards(
  query: string,
  options: SearchOptions = {},
): Promise<CardSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return [];
  }

  const parsed = parseCardSearchQuery(trimmed);
  const directMatches = await searchDirectCardMatches(parsed, options);
  if (
    parsed.localId &&
    parsed.setAliases.length > 0 &&
    directMatches.length > 0 &&
    (parsed.nameTokens.length === 0 || /[A-Z]/i.test(parsed.localId))
  ) {
    return dedupeResults(directMatches)
      .sort((a, b) => scoreSearchResult(b, parsed, options) - scoreSearchResult(a, parsed, options))
      .slice(0, 20);
  }

  const exactSetMatches = [
    ...directMatches,
    ...(await searchExactSetMatches(parsed, options)),
  ];
  if (parsed.localId && parsed.setAliases.length > 0 && exactSetMatches.length > 0) {
    return dedupeResults(exactSetMatches)
      .sort((a, b) => scoreSearchResult(b, parsed, options) - scoreSearchResult(a, parsed, options))
      .slice(0, 20);
  }

  let collectorOnlyPokemonMatches: CardSearchResult[] | undefined;
  if (isCollectorOnlySearch(parsed)) {
    collectorOnlyPokemonMatches = await searchPokemonTcgCards(trimmed, parsed);
    if (collectorOnlyPokemonMatches.length > 0) {
      return dedupeResults(collectorOnlyPokemonMatches)
        .sort((a, b) => scoreSearchResult(b, parsed, options) - scoreSearchResult(a, parsed, options))
        .slice(0, 20);
    }
  }

  const [
    pokemonTcgMatches,
    tcgTrackingMatches,
    broadMatches,
  ] = await Promise.all([
    collectorOnlyPokemonMatches
      ? Promise.resolve(collectorOnlyPokemonMatches)
      : searchPokemonTcgCards(trimmed, parsed),
    searchTcgTrackingMatches(parsed),
    searchBroadTcgDexMatches(trimmed, parsed, options),
  ]);

  return dedupeResults([
    ...exactSetMatches,
    ...pokemonTcgMatches,
    ...tcgTrackingMatches,
    ...broadMatches,
  ])
    .sort((a, b) => scoreSearchResult(b, parsed, options) - scoreSearchResult(a, parsed, options))
    .slice(0, 20);
}

export function parseCardSearchQuery(query: string): ParsedCardSearchQuery {
  const normalizedQuery = normalizeSearchText(query);
  const matchedGroups = findSetAliasGroups(normalizedQuery);
  let remaining = normalizedQuery;

  for (const match of matchedGroups) {
    remaining = removeAliasTerm(remaining, match.term);
  }

  const collector = extractCollectorId(remaining);
  if (collector.raw) {
    remaining = remaining.replace(collector.raw, " ");
  }

  const nameTokens = tokenize(remaining).filter(isNameToken);

  return {
    cleanedQuery: nameTokens.join(" "),
    localId: collector.localId,
    nameTokens,
    preferredSetId: preferredSetId(matchedGroups[0]?.term ?? "", matchedGroups),
    normalizedQuery,
    setAliases: dedupeAliases(matchedGroups.flatMap((match) => match.group.aliases)),
    setToken: matchedGroups[0]?.term ?? "",
    tcgTrackingSetIds: uniqueNumbers(
      matchedGroups.flatMap((match) => match.group.tcgTrackingSetIds ?? []),
    ),
  };
}

export function scoreSearchResult(
  result: CardSearchResult,
  parsed: ParsedCardSearchQuery,
  options: SearchOptions = {},
): number {
  let score = 0;
  const resultCollector = normalizeCollectorId(result.cardNumber);
  const queryCollector = normalizeCollectorId(parsed.localId);

  if (queryCollector && resultCollector === queryCollector) {
    score += 180;
  } else if (
    parsed.localId &&
    normalizeCollectorDigits(result.cardNumber) === normalizeCollectorDigits(parsed.localId)
  ) {
    score += 80;
  }

  if (matchesKnownSet(result, parsed)) {
    score += 140;
  }

  if (parsed.preferredSetId && result.tcgDexSetId === parsed.preferredSetId) {
    score += 28;
  }

  const normalizedName = normalizeSearchToken(result.name);
  for (const token of parsed.nameTokens) {
    if (normalizedName.includes(normalizeSearchToken(token))) {
      score += 38;
    } else {
      score -= 22;
    }
  }

  if (
    parsed.cleanedQuery &&
    normalizedName.includes(normalizeSearchToken(parsed.cleanedQuery))
  ) {
    score += 45;
  }

  if (options.preferredLanguage && result.language === options.preferredLanguage) {
    score += 46;
  } else if (options.languageBucket && languageBucketMatches(result.language, options.languageBucket)) {
    score += 24;
  } else if (result.language === "en" && !parsed.preferredSetId) {
    score += 6;
  }

  if (result.source === "tcgtracking") {
    score += 4;
  }

  if (result.source === "pokemontcg") {
    score += 10;
  }

  if (
    parsed.localId &&
    parsed.nameTokens.length === 0 &&
    parsed.setAliases.length === 0
  ) {
    score += setRecencyScore(result);
  }

  return score;
}

async function searchExactSetMatches(
  parsed: ParsedCardSearchQuery,
  options: SearchOptions,
): Promise<CardSearchResult[]> {
  if (!parsed.localId || parsed.setAliases.length === 0) {
    return [];
  }

  const settled = await Promise.allSettled(
    orderAliasesForOptions(parsed.setAliases, options).map((alias) =>
      fetchSetDetail(alias.setId, alias.language),
    ),
  );

  return settled
    .flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
    .flatMap((set) => mapMatchingSetCards(set, parsed.localId));
}

async function searchDirectCardMatches(
  parsed: ParsedCardSearchQuery,
  options: SearchOptions,
): Promise<CardSearchResult[]> {
  if (!parsed.localId || parsed.setAliases.length === 0) {
    return [];
  }

  const aliases = orderAliasesForOptions(parsed.setAliases, options);
  if (parsed.nameTokens.length === 0) {
    for (const alias of aliases) {
      const settled = await Promise.allSettled(
        directCardIds(alias.setId, parsed.localId).map((cardId) =>
          fetchCardDetail(cardId, alias.language),
        ),
      );
      const matches = settled
        .flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
        .map(mapCardDetail);

      if (matches.length > 0) {
        return matches;
      }
    }

    return [];
  }

  const settled = await Promise.allSettled(
    aliases.flatMap((alias) =>
      directCardIds(alias.setId, parsed.localId).map((cardId) =>
        fetchCardDetail(cardId, alias.language),
      ),
    ),
  );

  return settled
    .flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
    .map(mapCardDetail);
}

async function searchTcgTrackingMatches(
  parsed: ParsedCardSearchQuery,
): Promise<CardSearchResult[]> {
  if (parsed.tcgTrackingSetIds.length === 0) {
    return [];
  }

  const settled = await Promise.allSettled(
    parsed.tcgTrackingSetIds.map((setId) => fetchTcgTrackingSet(setId)),
  );

  return settled
    .flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
    .flatMap((set) =>
      (set.products ?? [])
        .filter((product) => productMatchesParsedQuery(product, parsed))
        .map((product) =>
          mapTcgTrackingProductToCard(product, {
            id: set.id,
            name: set.name,
          }),
        ),
    );
}

async function searchBroadTcgDexMatches(
  originalQuery: string,
  parsed: ParsedCardSearchQuery,
  options: SearchOptions,
): Promise<CardSearchResult[]> {
  const terms = uniqueStrings([
    parsed.cleanedQuery,
    parsed.nameTokens[0] ?? "",
    originalQuery,
  ]).filter((term) => term.length >= 2);

  const requests = broadSearchLanguagesForOptions(options).flatMap((language) => {
    const urls = terms.map(
      (term) =>
        `${TCGDEX_BASE_URL}/${language}/cards?name=${encodeURIComponent(
          term,
        )}&pagination:page=1&pagination:itemsPerPage=20`,
    );

    if (parsed.localId) {
      urls.push(
        `${TCGDEX_BASE_URL}/${language}/cards?localId=${encodeURIComponent(
          parsed.localId,
        )}&pagination:page=1&pagination:itemsPerPage=20`,
      );
    }

    return urls.map((url) => fetchCardBriefs(url, language));
  });

  const settled = await Promise.allSettled(requests);
  const candidates = new Map<
    string,
    { card: TcgDexCardBrief; language: SearchLanguage }
  >();

  for (const result of settled) {
    if (result.status !== "fulfilled") {
      continue;
    }

    for (const candidate of result.value) {
      if (!candidates.has(candidate.card.id)) {
        candidates.set(candidate.card.id, candidate);
      }
    }
  }

  const details = await Promise.allSettled(
    Array.from(candidates.values())
      .slice(0, 30)
      .map((candidate) => fetchCardDetail(candidate.card.id, candidate.language)),
  );

  return details
    .flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
    .filter((card) => Boolean(card.id && card.name))
    .map(mapCardDetail);
}

async function fetchSetDetail(
  setId: string,
  language: SearchLanguage,
): Promise<TcgDexSetDetail & { language: SearchLanguage }> {
  const cacheKey = `${language}:${setId}`;
  const cached = setDetailCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const response = await fetch(`${TCGDEX_BASE_URL}/${language}/sets/${setId}`);
  if (!response.ok) {
    throw new Error(`TCGdex set failed with ${response.status}`);
  }

  const set = (await response.json()) as TcgDexSetDetail;
  const value = { ...set, language };
  setDetailCache.set(cacheKey, {
    expiresAt: Date.now() + SET_DETAIL_CACHE_TTL_MS,
    value,
  });
  return value;
}

async function fetchCardBriefs(
  url: string,
  language: SearchLanguage,
): Promise<Array<{ card: TcgDexCardBrief; language: SearchLanguage }>> {
  const cacheKey = `${language}:${url}`;
  const cached = cardBriefsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`TCGdex search failed with ${response.status}`);
  }

  const data = (await response.json()) as TcgDexCardBrief[];
  const value = Array.isArray(data)
    ? data.map((card) => ({ card, language }))
    : [];
  cardBriefsCache.set(cacheKey, {
    expiresAt: Date.now() + CARD_BRIEFS_CACHE_TTL_MS,
    value,
  });
  return value;
}

async function fetchCardDetail(
  id: string,
  language: SearchLanguage,
): Promise<TcgDexCardDetail & { language: SearchLanguage }> {
  const cacheKey = `${language}:${id}`;
  const cached = cardDetailCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const response = await fetch(`${TCGDEX_BASE_URL}/${language}/cards/${id}`);
  if (!response.ok) {
    throw new Error(`TCGdex card failed with ${response.status}`);
  }

  const card = (await response.json()) as TcgDexCardDetail;
  const value = { ...card, language };
  cardDetailCache.set(cacheKey, {
    expiresAt: Date.now() + CARD_DETAIL_CACHE_TTL_MS,
    value,
  });
  return value;
}

function mapCardDetail(
  card: TcgDexCardDetail & { language?: SearchLanguage },
): CardSearchResult {
  const officialCount = card.set?.cardCount?.official || card.set?.cardCount?.total;
  const cardNumber = officialCount
    ? `${card.localId}/${officialCount}`
    : card.localId;

  return {
    id: card.id,
    name: card.name,
    setName: card.set?.name ?? "",
    cardNumber,
    imageUrl: card.image ? `${card.image}/low.webp` : "",
    language: card.language ?? "en",
    source: "tcgdex",
    tcgDexSetId: card.set?.id,
  };
}

function mapMatchingSetCards(
  set: TcgDexSetDetail & { language: SearchLanguage },
  localId: string,
): CardSearchResult[] {
  const cards = set.cards ?? [];
  const queryCollector = normalizeCollectorId(localId);
  const queryDigits = normalizeCollectorDigits(localId);
  const setCount = set.cardCount?.official || set.cardCount?.total;

  return cards
    .filter((card) => {
      const cardCollector = normalizeCollectorId(card.localId);
      return (
        cardCollector === queryCollector ||
        normalizeCollectorDigits(card.localId) === queryDigits
      );
    })
    .map((card) => ({
      id: card.id,
      name: card.name,
      setName: set.name,
      cardNumber: setCount ? `${card.localId}/${setCount}` : card.localId,
      imageUrl: card.image ? `${card.image}/low.webp` : "",
      language: set.language,
      source: "tcgdex",
      tcgDexSetId: set.id,
    }));
}

function productMatchesParsedQuery(
  product: { name: string; clean_name?: string; number?: string },
  parsed: ParsedCardSearchQuery,
): boolean {
  const cardNumber = product.number ?? "";
  const name = normalizeSearchToken(product.clean_name || product.name);
  const numberMatches =
    !parsed.localId ||
    normalizeCollectorId(cardNumber) === normalizeCollectorId(parsed.localId) ||
    normalizeCollectorDigits(cardNumber) === normalizeCollectorDigits(parsed.localId);
  const nameMatches =
    parsed.nameTokens.length === 0 ||
    parsed.nameTokens.some((token) => name.includes(normalizeSearchToken(token)));

  return numberMatches && nameMatches;
}

function directCardIds(setId: string, localId: string): string[] {
  const compact = normalizeCollectorId(localId);
  const digits = normalizeCollectorDigits(localId);
  const candidates = [compact];

  if (digits && compact === digits) {
    candidates.push(digits.padStart(2, "0"), digits.padStart(3, "0"));
  }

  return uniqueStrings(candidates)
    .filter(Boolean)
    .map((candidate) => `${setId}-${candidate}`);
}

function findSetAliasGroups(
  normalizedQuery: string,
): Array<{ group: SetAliasGroup; term: string }> {
  const matches: Array<{ group: SetAliasGroup; term: string; index: number }> = [];
  for (const group of SET_ALIAS_GROUPS) {
    for (const term of group.terms) {
      const normalizedTerm = normalizeSearchText(term);
      const index = aliasIndex(normalizedQuery, normalizedTerm);
      if (index >= 0) {
        matches.push({ group, term: normalizedTerm, index });
      }
    }
  }

  for (const dynamicMatch of findDynamicSetAliasGroups(normalizedQuery)) {
    matches.push(dynamicMatch);
  }

  return matches
    .sort((a, b) => b.term.length - a.term.length || a.index - b.index)
    .filter((match, index, all) => {
      const groupIndex = all.findIndex((candidate) => candidate.group === match.group);
      return groupIndex === index;
    });
}

function findDynamicSetAliasGroups(
  normalizedQuery: string,
): Array<{ group: SetAliasGroup; term: string; index: number }> {
  const matches: Array<{ group: SetAliasGroup; term: string; index: number }> = [];
  for (const match of normalizedQuery.matchAll(/\b[A-Z]?SV(\d{1,2})([A-Z])\b/g)) {
    const term = match[0];
    const canonicalTerm = `SV${match[1]}${match[2]}`;
    const setId = `SV${match[1]}${match[2].toLowerCase()}`;
    const aliases = specialJapaneseSetAliases(canonicalTerm, setId);
    matches.push({
      group: group([term], aliases),
      term,
      index: match.index ?? 0,
    });
  }

  return matches;
}

function preferredSetId(
  setToken: string,
  matches: Array<{ group: SetAliasGroup; term: string }>,
): string {
  const normalizedToken = normalizeSearchToken(setToken);
  const aliases = matches.flatMap((match) => match.group.aliases);
  const exact = aliases.find(
    (alias) => {
      const aliasToken = normalizeSearchToken(alias.setId);
      return normalizedToken === aliasToken || normalizedToken.endsWith(aliasToken);
    },
  );

  return exact?.setId ?? "";
}

function specialJapaneseSetAliases(term: string, setId: string): SetAlias[] {
  const special: Record<string, SetAlias[]> = {
    SV2A: [
      { language: "en", setId: "sv03.5", label: "Pokemon 151" },
      { language: "ja", setId: "SV2a", label: "Pokemon Card 151" },
    ],
    SV4A: [
      { language: "en", setId: "sv04.5", label: "Paldean Fates" },
      { language: "ja", setId: "SV4a", label: "Shiny Treasure ex" },
    ],
    SV8A: [
      { language: "en", setId: "sv08.5", label: "Prismatic Evolutions" },
      { language: "ja", setId: "SV8a", label: "Terastal Fest ex" },
    ],
  };

  return (
    special[term] ?? [
      {
        language: "ja",
        setId,
        label: setId,
      },
    ]
  );
}

function extractCollectorId(text: string): { localId: string; raw: string } {
  const slash = text.match(/\b((?:(?:TG|GG|SWSH|SM|XY|BW|DP|HGSS|SVP|SV)\s*)?0*\d{1,4})\s*\/\s*((?:(?:TG|GG|SWSH|SM|XY|BW|DP|HGSS|SVP|SV)\s*)?\d{1,4})\b/i);
  if (slash) {
    return { localId: compactCollector(slash[1]), raw: slash[0] };
  }

  const alphaNumeric = text.match(/\b((?:TG|GG|SWSH|SM|XY|BW|DP|HGSS|SVP|SV)\s*0*\d{1,4})\b/i);
  if (alphaNumeric) {
    return { localId: compactCollector(alphaNumeric[1]), raw: alphaNumeric[0] };
  }

  const numeric = Array.from(text.matchAll(/\b(\d{1,4})\b/g))
    .map((match) => ({ value: match[1], raw: match[0], index: match.index ?? 0 }))
    .filter((match) => !isLikelyYear(match.value));
  const selected = numeric.at(-1);
  return selected
    ? { localId: compactCollector(selected.value), raw: selected.raw }
    : { localId: "", raw: "" };
}

function compactCollector(value: string): string {
  return normalizeCollectorId(value) || value.replace(/\s+/g, "").toUpperCase();
}

function normalizeCollectorId(value: string): string {
  const firstPart = value.split("/")[0] ?? "";
  const compact = firstPart.replace(/[^a-z0-9]/gi, "").toUpperCase();
  const match = compact.match(/^([A-Z]*?)0*(\d+)$/);
  return match ? `${match[1]}${Number(match[2])}` : compact;
}

function normalizeCollectorDigits(value: string): string {
  const match = value.match(/\d{1,4}/);
  return match ? String(Number(match[0])) : "";
}

function matchesKnownSet(
  result: CardSearchResult,
  parsed: ParsedCardSearchQuery,
): boolean {
  if (parsed.setAliases.length === 0 && parsed.tcgTrackingSetIds.length === 0) {
    return false;
  }

  const normalizedSet = normalizeSearchToken(result.setName);
  return (
    parsed.setAliases.some(
      (alias) =>
        result.tcgDexSetId === alias.setId ||
        normalizedSet.includes(normalizeSearchToken(alias.label)),
    ) ||
    parsed.tcgTrackingSetIds.some((setId) => result.tcgTrackingSetId === setId)
  );
}

function broadSearchLanguagesForOptions(options: SearchOptions): SearchLanguage[] {
  const primaryBucketLanguage =
    options.languageBucket === "western" ? "en" : "ja";

  return uniqueStrings([
    options.preferredLanguage ?? "",
    primaryBucketLanguage,
    "en",
    "ja",
  ]) as SearchLanguage[];
}

function orderAliasesForOptions(
  aliases: SetAlias[],
  options: SearchOptions,
): SetAlias[] {
  return expandAliasesForOptions(aliases, options).sort(
    (a, b) => languagePreferenceScore(b.language, options) - languagePreferenceScore(a.language, options),
  );
}

function expandAliasesForOptions(
  aliases: SetAlias[],
  options: SearchOptions,
): SetAlias[] {
  const expanded = [...aliases];
  const preferred = options.preferredLanguage;

  if (preferred) {
    for (const alias of aliases) {
      if (
        languageBucketMatches(alias.language, "western") &&
        languageBucketMatches(preferred, "western") &&
        alias.language !== preferred
      ) {
        expanded.push({ ...alias, language: preferred });
      }

      if (
        languageBucketMatches(alias.language, "asian") &&
        languageBucketMatches(preferred, "asian") &&
        alias.language !== preferred
      ) {
        expanded.push({ ...alias, language: preferred });
      }
    }
  }

  return dedupeAliases(expanded);
}

function languagePreferenceScore(
  language: string,
  options: SearchOptions,
): number {
  if (options.preferredLanguage && language === options.preferredLanguage) {
    return 3;
  }

  if (options.languageBucket && languageBucketMatches(language, options.languageBucket)) {
    return 2;
  }

  return language === "en" ? 1 : 0;
}

function languageBucketMatches(
  language: string,
  bucket: LanguageBucket,
): boolean {
  return bucket === "asian"
    ? ASIAN_SEARCH_LANGUAGES.includes(language as SearchLanguage)
    : WESTERN_SEARCH_LANGUAGES.includes(language as SearchLanguage);
}

function isCollectorOnlySearch(parsed: ParsedCardSearchQuery): boolean {
  return (
    Boolean(parsed.localId) &&
    parsed.nameTokens.length === 0 &&
    parsed.setAliases.length === 0 &&
    parsed.tcgTrackingSetIds.length === 0
  );
}

function setRecencyScore(result: CardSearchResult): number {
  const setId = [
    result.pokemonTcgSetId,
    result.tcgDexSetId,
    result.id,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const sv = setId.match(/\bsv(?:0?)(\d{1,2})(?:\.5|pt5)?/);
  if (sv) {
    return 300 + Number(sv[1]);
  }

  const swsh = setId.match(/\bswsh(?:0?)(\d{1,2})/);
  if (swsh) {
    return 200 + Number(swsh[1]);
  }

  const sm = setId.match(/\bsm(?:0?)(\d{1,2})/);
  if (sm) {
    return 100 + Number(sm[1]);
  }

  const ex = setId.match(/\bex(?:0?)(\d{1,2})/);
  if (ex) {
    return Number(ex[1]);
  }

  return 0;
}

function removeAliasTerm(value: string, term: string): string {
  return value
    .replace(new RegExp(`(^|\\s)${escapeRegExp(term)}(?=\\s|$)`, "i"), " ")
    .replace(/\s+/g, " ")
    .trim();
}

function aliasIndex(value: string, term: string): number {
  const match = value.match(new RegExp(`(^|\\s)${escapeRegExp(term)}(?=\\s|$)`, "i"));
  return match?.index ?? -1;
}

function tokenize(value: string): string[] {
  return value.split(/\s+/).filter(Boolean);
}

function isNameToken(token: string): boolean {
  return /[A-Z]/i.test(token) && !/^(NO|CARD|NUMBER|NUM)$/i.test(token);
}

function normalizeSearchText(value: string): string {
  return normalizeSearchToken(value).replace(/\s+/g, " ").trim();
}

function normalizeSearchToken(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9/#.]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function isLikelyYear(value: string): boolean {
  const year = Number(value);
  return year >= 1900 && year <= 2099;
}

function dedupeResults(results: CardSearchResult[]): CardSearchResult[] {
  const merged = new Map<string, CardSearchResult>();
  for (const result of results) {
    const key = [
      normalizeSearchToken(result.name),
      normalizeSearchToken(result.setName),
      normalizeCollectorId(result.cardNumber),
    ].join("|");
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, result);
      continue;
    }

    merged.set(key, {
      ...existing,
      tcgTrackingProductId:
        existing.tcgTrackingProductId ?? result.tcgTrackingProductId,
      tcgTrackingSetId: existing.tcgTrackingSetId ?? result.tcgTrackingSetId,
      cardmarketId: existing.cardmarketId ?? result.cardmarketId,
      pokemonTcgId: existing.pokemonTcgId ?? result.pokemonTcgId,
      pokemonTcgSetId: existing.pokemonTcgSetId ?? result.pokemonTcgSetId,
    });
  }

  return Array.from(merged.values());
}

function dedupeAliases(aliases: SetAlias[]): SetAlias[] {
  const seen = new Set<string>();
  return aliases.filter((alias) => {
    const key = `${alias.language}:${alias.setId}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values));
}

function group(
  terms: string[],
  aliases: SetAlias[],
  tcgTrackingSetIds: number[] = [],
): SetAliasGroup {
  return { terms, aliases, tcgTrackingSetIds };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
