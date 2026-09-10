import type {
  CardLanguage,
  ReferencePriceFilters,
  ReferenceValues,
} from "./calculations";
import type { CardSearchResult } from "./tcgdex";

const USD_TO_DKK = 7;
const POKEPRICES_BASE_URL = "https://www.pokeprices.io";
const POKEPRICES_SUPABASE_URL = "https://egidpsrkqvymvioidatc.supabase.co";
const POKEPRICES_PUBLIC_ANON_KEY =
  process.env.POKEPRICES_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnaWRwc3JrcXZ5bXZpb2lkYXRjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0MTAxMTQsImV4cCI6MjA4Njk4NjExNH0.2LPdmE_CpDbgrwTXdODaLswxZNwstFinEA4fSq8Cj8o";
const CACHE_TTL_MS = 1000 * 60 * 60 * 12;
const TCGDEX_BASE_URL = "https://api.tcgdex.net/v2";

type PokePricesCard = {
  raw_usd?: number | null;
  psa9_usd?: number | null;
  psa10_usd?: number | null;
};

type PokePricesUsdValues = {
  rawUsd?: number;
  psa9Usd?: number;
  psa10Usd?: number;
  sourceUrl?: string;
};

type PokePricesCandidate = {
  cardSlug: string;
  setName: string;
};

type PokePricesSearchResult = {
  result_type?: string;
  name?: string;
  subtitle?: string;
  card_number?: string | null;
  card_number_display?: string | null;
  url_slug?: string;
};

type TcgDexEnglishEquivalent = {
  id?: string;
  attacks?: Array<{
    cost?: string[];
    damage?: number | string;
  }>;
  hp?: number;
  illustrator?: string;
  localId?: string;
  name?: string;
  set?: {
    id?: string;
    name?: string;
    cardCount?: {
      official?: number;
      total?: number;
    };
  };
  stage?: string;
  types?: string[];
};

const cache = new Map<string, { expiresAt: number; values: ReferenceValues }>();

export async function fetchPokePricesReferenceValues(
  card: CardSearchResult,
  filters: ReferencePriceFilters = {},
): Promise<ReferenceValues> {
  if (!shouldUsePokePricesForCard(card, filters)) {
    return emptyValues();
  }

  const cacheKey = [
    card.source,
    card.id,
    card.name,
    card.setName,
    card.cardNumber,
    filters.cardLanguage ?? "",
  ].join(":");
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.values;
  }

  const values = await fetchPokePricesUsdValues(card);
  const mapped = mapPokePricesValues(values);
  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, values: mapped });
  return mapped;
}

export function shouldUsePokePricesForCard(
  card: Pick<CardSearchResult, "language">,
  filters: ReferencePriceFilters = {},
): boolean {
  return !isAsianReference(card.language, filters);
}

export function buildPokePricesCardSlug(card: {
  name: string;
  cardNumber?: string;
}): string {
  const collector = normalizeCollectorForSlug(card.cardNumber ?? "");
  return [slugify(card.name), collector].filter(Boolean).join("-");
}

export function buildPokePricesSearchQuery(card: {
  name: string;
  cardNumber?: string;
}): string {
  const collector = normalizeCollectorForSlug(card.cardNumber ?? "");
  return [normalizeSearchName(card.name), collector].filter(Boolean).join(" ");
}

export function getPokePricesSetNameCandidates(card: {
  setName: string;
  tcgDexSetId?: string;
  pokemonTcgSetId?: string;
}): string[] {
  return uniqueStrings([
    knownPokePricesSetName(card),
    card.setName,
    normalizePokePricesSetName(card.setName),
  ]);
}

export function parsePokePricesHtml(html: string): PokePricesUsdValues {
  const unescaped = html
    .replace(/\\"/g, '"')
    .replace(/\\u0024/g, "$")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'");

  return {
    rawUsd:
      parseJsonCents(unescaped, "raw_usd") ??
      parseDollar(unescaped, /raw price of \$([\d,.]+)/i) ??
      parseDollar(unescaped, /\$([\d,.]+)\s*Raw\b/i),
    psa9Usd:
      parseJsonCents(unescaped, "psa9_usd") ??
      parseDollar(unescaped, /PSA\s*9\s*\$([\d,.]+)/i) ??
      parseDollar(unescaped, /\$([\d,.]+)\s*PSA\s*9\b/i),
    psa10Usd:
      parseJsonCents(unescaped, "psa10_usd") ??
      parseDollar(unescaped, /PSA\s*10\s*\$([\d,.]+)/i) ??
      parseDollar(unescaped, /\$([\d,.]+)\s*PSA\s*10\b/i),
  };
}

async function fetchPokePricesUsdValues(
  card: CardSearchResult,
): Promise<PokePricesUsdValues> {
  const candidates = await buildPokePricesCandidates(card);
  const rpcValues = await fetchFirstPokePricesRpc(candidates);
  if (hasAnyValue(rpcValues)) {
    return rpcValues;
  }

  return fetchFirstPokePricesHtml(candidates);
}

async function buildPokePricesCandidates(
  card: CardSearchResult,
): Promise<PokePricesCandidate[]> {
  const candidateCards = [card, await fetchEnglishEquivalentCard(card)].filter(
    (candidate): candidate is CardSearchResult => Boolean(candidate),
  );

  const directCandidates = candidateCards.flatMap((candidate) => {
    const cardSlug = buildPokePricesCardSlug(candidate);
    if (!cardSlug) {
      return [];
    }

    return getPokePricesSetNameCandidates(candidate).map((setName) => ({
      cardSlug,
      setName,
    }));
  });

  const searchCandidates = (
    await Promise.all(candidateCards.map(searchPokePricesCandidates))
  ).flat();

  return uniqueCandidates([...directCandidates, ...searchCandidates]).slice(0, 10);
}

async function fetchFirstPokePricesRpc(
  candidates: PokePricesCandidate[],
): Promise<PokePricesUsdValues> {
  for (const candidate of candidates) {
    try {
      const values = await fetchPokePricesRpc(candidate.setName, candidate.cardSlug);
      if (hasAnyValue(values)) {
        return { ...values, sourceUrl: pokePricesCardUrl(candidate) };
      }
    } catch {
      // Try the next candidate. HTML metadata is the final fallback.
    }
  }

  return {};
}

async function fetchFirstPokePricesHtml(
  candidates: PokePricesCandidate[],
): Promise<PokePricesUsdValues> {
  for (const candidate of candidates) {
    try {
      const response = await fetch(
        `${POKEPRICES_BASE_URL}/set/${encodeURIComponent(
          candidate.setName,
        )}/card/${candidate.cardSlug}`,
        {
          headers: {
            "user-agent": "CardScope research prototype",
          },
        },
      );
      if (!response.ok) {
        continue;
      }

      const values = parsePokePricesHtml(await response.text());
      if (hasAnyValue(values)) {
        return { ...values, sourceUrl: pokePricesCardUrl(candidate) };
      }
    } catch {
      // Keep the calculator usable if PokePrices is unavailable.
    }
  }

  return {};
}

async function fetchPokePricesRpc(
  setName: string,
  cardSlug: string,
): Promise<PokePricesUsdValues> {
  const response = await fetch(
    `${POKEPRICES_SUPABASE_URL}/rest/v1/rpc/get_card_detail_by_url_slug`,
    {
      method: "POST",
      headers: {
        apikey: POKEPRICES_PUBLIC_ANON_KEY,
        authorization: `Bearer ${POKEPRICES_PUBLIC_ANON_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        p_set_name: setName,
        p_card_url_slug: cardSlug,
      }),
    },
  );
  if (!response.ok) {
    return {};
  }

  const data = (await response.json()) as PokePricesCard | null;
  return mapPokePricesCard(data);
}

async function searchPokePricesCandidates(
  card: CardSearchResult,
): Promise<PokePricesCandidate[]> {
  const query = buildPokePricesSearchQuery(card);
  if (query.length < 2 || !hasAsciiLetter(query)) {
    return [];
  }

  try {
    const response = await fetch(
      `${POKEPRICES_SUPABASE_URL}/rest/v1/rpc/search_global`,
      {
        method: "POST",
        headers: {
          apikey: POKEPRICES_PUBLIC_ANON_KEY,
          authorization: `Bearer ${POKEPRICES_PUBLIC_ANON_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ query }),
      },
    );
    if (!response.ok) {
      return [];
    }

    const results = (await response.json()) as PokePricesSearchResult[] | null;
    return (results ?? [])
      .filter((result) => pokePricesSearchResultMatches(result, card))
      .map((result) => ({
        cardSlug: result.url_slug ?? "",
        setName: result.subtitle ?? "",
      }))
      .filter((candidate) => candidate.cardSlug && candidate.setName)
      .slice(0, 4);
  } catch {
    return [];
  }
}

async function fetchEnglishEquivalentCard(
  card: CardSearchResult,
): Promise<CardSearchResult | undefined> {
  const equivalentSetId = englishEquivalentSetId(card);
  const localId = normalizeCollectorForSlug(card.cardNumber);
  if (!equivalentSetId || !localId) {
    return undefined;
  }

  const sourceDetail = await fetchTcgDexCardDetail(card.language || "ja", card.id);
  const candidateIds = buildEnglishEquivalentCandidateIds(equivalentSetId, localId);
  const settled = await Promise.allSettled(
    candidateIds.map((id) => fetchTcgDexCardDetail("en", id)),
  );
  const candidates = settled.flatMap((result) =>
    result.status === "fulfilled" && result.value ? [result.value] : [],
  );
  const selected = selectBestEnglishEquivalent(sourceDetail, candidates, localId);
  if (!selected) {
    return undefined;
  }

  return mapTcgDexEquivalent(selected, card.imageUrl, equivalentSetId);
}

async function fetchTcgDexCardDetail(
  language: string,
  id: string,
): Promise<TcgDexEnglishEquivalent | undefined> {
  try {
    const response = await fetch(
      `${TCGDEX_BASE_URL}/${language}/cards/${encodeURIComponent(id)}`,
    );
    if (!response.ok) {
      return undefined;
    }

    return (await response.json()) as TcgDexEnglishEquivalent;
  } catch {
    return undefined;
  }
}

function mapTcgDexEquivalent(
  detail: TcgDexEnglishEquivalent,
  fallbackImageUrl: string,
  fallbackSetId: string,
): CardSearchResult {
  const officialCount = detail.set?.cardCount?.official || detail.set?.cardCount?.total;
  const cardNumber = officialCount
    ? `${detail.localId ?? ""}/${officialCount}`
    : (detail.localId ?? "");

  return {
    id: detail.id ?? "",
    name: detail.name ?? "",
    setName: detail.set?.name ?? "",
    cardNumber,
    imageUrl: fallbackImageUrl,
    language: "en",
    source: "tcgdex",
    tcgDexSetId: detail.set?.id ?? fallbackSetId,
  };
}

function buildEnglishEquivalentCandidateIds(
  setId: string,
  localId: string,
): string[] {
  const numeric = Number(localId);
  if (!Number.isFinite(numeric)) {
    return [`${setId}-${localId}`];
  }

  const candidates = [numeric];
  for (let offset = 1; offset <= 10; offset += 1) {
    candidates.push(numeric - offset, numeric + offset);
  }

  return uniqueStrings(
    candidates
      .filter((candidate) => candidate > 0)
      .map((candidate) => `${setId}-${candidate}`),
  );
}

function selectBestEnglishEquivalent(
  source: TcgDexEnglishEquivalent | undefined,
  candidates: TcgDexEnglishEquivalent[],
  originalLocalId: string,
): TcgDexEnglishEquivalent | undefined {
  if (!source) {
    return candidates.find((candidate) => candidate.localId === originalLocalId);
  }

  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: scoreEnglishEquivalent(source, candidate, originalLocalId),
    }))
    .sort((a, b) => b.score - a.score);

  return scored[0] && scored[0].score >= 70 ? scored[0].candidate : undefined;
}

function scoreEnglishEquivalent(
  source: TcgDexEnglishEquivalent,
  candidate: TcgDexEnglishEquivalent,
  originalLocalId: string,
): number {
  let score = candidate.localId === originalLocalId ? 8 : 0;

  if (source.illustrator && candidate.illustrator === source.illustrator) {
    score += 70;
  }

  if (source.hp && candidate.hp === source.hp) {
    score += 20;
  }

  if (source.stage && candidate.stage === source.stage) {
    score += 12;
  }

  if (sameStringList(source.types, candidate.types)) {
    score += 18;
  }

  if (attackSignature(source) && attackSignature(source) === attackSignature(candidate)) {
    score += 30;
  }

  return score;
}

function attackSignature(card: TcgDexEnglishEquivalent): string {
  return (card.attacks ?? [])
    .map((attack) => {
      const cost = (attack.cost ?? []).join("");
      return `${cost}:${String(attack.damage ?? "")}`;
    })
    .join("|");
}

function sameStringList(
  left: string[] | undefined,
  right: string[] | undefined,
): boolean {
  if (!left?.length || !right?.length || left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function mapPokePricesCard(
  data: PokePricesCard | null | undefined,
): PokePricesUsdValues {
  return {
    rawUsd: centsToUsd(data?.raw_usd),
    psa9Usd: centsToUsd(data?.psa9_usd),
    psa10Usd: centsToUsd(data?.psa10_usd),
  };
}

function mapPokePricesValues(values: PokePricesUsdValues): ReferenceValues {
  const hasValues = hasAnyValue(values);
  return {
    rawDkk: values.rawUsd ? Math.round(values.rawUsd * USD_TO_DKK) : undefined,
    psa9Dkk: values.psa9Usd ? Math.round(values.psa9Usd * USD_TO_DKK) : undefined,
    psa10Dkk: values.psa10Usd ? Math.round(values.psa10Usd * USD_TO_DKK) : undefined,
    rawSource: values.rawUsd ? "pokeprices" : undefined,
    psa9Source: values.psa9Usd ? "pokeprices" : undefined,
    psa10Source: values.psa10Usd ? "pokeprices" : undefined,
    sources: hasValues ? ["pokeprices"] : [],
    sourceUrls: values.sourceUrl ? { pokeprices: values.sourceUrl } : {},
    fetchedAt: new Date().toISOString(),
  };
}

function knownPokePricesSetName(card: {
  setName: string;
  tcgDexSetId?: string;
  pokemonTcgSetId?: string;
}): string | undefined {
  const setId = (card.tcgDexSetId ?? card.pokemonTcgSetId ?? "").toLowerCase();
  const normalizedSetName = normalizeSearchName(card.setName);

  const known: Record<string, string> = {
    "sv03.5": "Scarlet & Violet 151",
    sv3pt5: "Scarlet & Violet 151",
    sv2a: "Scarlet & Violet 151",
    "sv08.5": "Prismatic Evolutions",
    sv8pt5: "Prismatic Evolutions",
    sv8a: "Prismatic Evolutions",
    "sv04.5": "Paldean Fates",
    sv4pt5: "Paldean Fates",
    sv4a: "Paldean Fates",
  };

  if (known[setId]) {
    return known[setId];
  }

  if (normalizedSetName === "151" || normalizedSetName === "POKEMON CARD 151") {
    return "Scarlet & Violet 151";
  }

  return undefined;
}

function englishEquivalentSetId(card: CardSearchResult): string | undefined {
  const setId = (card.tcgDexSetId ?? "").toLowerCase();
  const equivalent: Record<string, string> = {
    sv2a: "sv03.5",
    sv4a: "sv04.5",
    sv8a: "sv08.5",
  };

  return equivalent[setId];
}

function pokePricesSearchResultMatches(
  result: PokePricesSearchResult,
  card: CardSearchResult,
): boolean {
  if (result.result_type !== "card" || !result.url_slug || !result.subtitle) {
    return false;
  }

  const queryCollector = normalizeCollectorForSlug(card.cardNumber);
  const resultCollector = normalizeCollectorForSlug(
    result.card_number_display ?? result.card_number ?? "",
  );
  if (queryCollector && resultCollector && queryCollector !== resultCollector) {
    return false;
  }

  const queryName = normalizeSearchName(card.name);
  const resultName = normalizeSearchName(result.name ?? "");
  if (!queryName || !resultName) {
    return true;
  }

  return queryName
    .split(" ")
    .filter((token) => token.length > 1)
    .some((token) => resultName.includes(token));
}

function normalizePokePricesSetName(setName: string): string {
  return setName
    .replace(/^[A-Z0-9]+:\s*/i, "")
    .replace(/\s+Trainer Gallery$/i, "")
    .replace(/^Pokemon /i, "")
    .trim();
}

function normalizeCollectorForSlug(cardNumber: string): string {
  const firstPart = cardNumber.split("/")[0] ?? "";
  return firstPart
    .replace(/[^a-z0-9]/gi, "")
    .replace(/^0+(?=\d)/, "")
    .toLowerCase();
}

function normalizeSearchName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function parseJsonCents(value: string, key: string): number | undefined {
  const match = value.match(new RegExp(`"${key}"\\s*:?\\s*(\\d+)`, "i"));
  return centsToUsd(match?.[1] ? Number(match[1]) : undefined);
}

function parseDollar(value: string, pattern: RegExp): number | undefined {
  const match = value.match(pattern);
  if (!match?.[1]) {
    return undefined;
  }

  const parsed = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function centsToUsd(value: number | null | undefined): number | undefined {
  if (!value || value <= 0) {
    return undefined;
  }

  return value / 100;
}

function hasAnyValue(values: PokePricesUsdValues): boolean {
  return Boolean(values.rawUsd || values.psa9Usd || values.psa10Usd);
}

function emptyValues(): ReferenceValues {
  return {
    sources: [],
    fetchedAt: new Date().toISOString(),
  };
}

function isAsianReference(
  cardLanguage: string | undefined,
  filters: ReferencePriceFilters,
): boolean {
  return (
    filters.languageBucket === "asian" ||
    isAsianLanguage(filters.cardLanguage) ||
    isAsianLanguage(cardLanguage)
  );
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

function hasAsciiLetter(value: string): boolean {
  return /[a-z]/i.test(value);
}

function pokePricesCardUrl(candidate: PokePricesCandidate): string {
  return `${POKEPRICES_BASE_URL}/set/${encodeURIComponent(
    candidate.setName,
  )}/card/${candidate.cardSlug}`;
}

function uniqueCandidates(
  candidates: PokePricesCandidate[],
): PokePricesCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.setName}:${candidate.cardSlug}`.toLowerCase();
    if (!candidate.setName || !candidate.cardSlug || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );
}
