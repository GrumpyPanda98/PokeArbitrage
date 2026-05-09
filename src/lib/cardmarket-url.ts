import {
  CARDMARKET_CONDITION_IDS,
  CARDMARKET_LANGUAGE_IDS,
  type CardLanguage,
  type RawCardCondition,
} from "./calculations";

type CardmarketSearchCard = {
  cardNumber?: string;
  id?: string;
  idProduct?: number;
  name?: string;
  setId?: string;
  setName?: string;
};

export type CardmarketUrlFilters = {
  language?: CardLanguage;
  minCondition?: RawCardCondition;
};

const CARDMARKET_BASE_URL = "https://www.cardmarket.com/en/Pokemon";
const CARDMARKET_API_BASE_URL = "https://apiv2.cardmarket.com/ws/v2.0";

const CARDMARKET_SET_CODES: Record<string, string> = {
  ex9: "EM",
  fut2020: "FUT20",
  sv02: "PAL",
  sv03: "OBF",
  "sv03.5": "MEW",
  sv04: "PAR",
  "sv04.5": "PAF",
  sv05: "TEF",
  sv06: "TWM",
  sv07: "SCR",
  sv08: "SSP",
  "sv08.5": "PRE",
  sv2a: "SV2a",
  sv4a: "SV4a",
  sv8a: "SV8a",
  swsh7: "EVS",
  swsh8: "FST",
  swsh9: "BRS",
  swsh9tg: "BRS",
  swsh10: "ASR",
  swsh10tg: "ASR",
  swsh11: "LOR",
  swsh11tg: "LOR",
  swsh12: "SIT",
  swsh12tg: "SIT",
  "swsh12.5": "CRZ",
};

export function buildCardmarketSearchUrl(
  card: CardmarketSearchCard,
  filters: CardmarketUrlFilters = {},
): string {
  const query = buildCardmarketSearchQuery(card, filters);
  const params = [
    `searchString=${encodeURIComponent(query)}`,
    ...cardmarketWebsiteFilterParams(filters),
  ];

  return `${CARDMARKET_BASE_URL}/Products/Search?${params.join("&")}`;
}

export function buildCardmarketArticlesApiUrl(
  idProduct: number,
  filters: CardmarketUrlFilters = {},
): string {
  const params = new URLSearchParams({
    maxResults: "10",
    start: "0",
  });
  const languageId = filters.language
    ? CARDMARKET_LANGUAGE_IDS[filters.language]
    : undefined;

  if (languageId) {
    params.set("idLanguage", String(languageId));
  }

  if (filters.minCondition) {
    params.set("minCondition", filters.minCondition);
  }

  return `${CARDMARKET_API_BASE_URL}/articles/${idProduct}?${params.toString()}`;
}

export function buildCardmarketSearchQuery(
  card: CardmarketSearchCard,
  filters: CardmarketUrlFilters = {},
): string {
  const setCode = cardmarketSetCode(card);
  const collector = collectorNumber(card.cardNumber ?? card.id ?? "");
  const name = shouldUseCodeOnlySearch(card, filters)
    ? ""
    : asciiName(card.name ?? "");
  return [name, setCode || card.setName, collector].filter(Boolean).join(" ");
}

function cardmarketSetCode(card: CardmarketSearchCard): string {
  const setId = normalizeSetId(card.setId ?? setIdFromCardId(card.id ?? ""));
  return CARDMARKET_SET_CODES[setId] ?? card.setId ?? "";
}

function setIdFromCardId(id: string): string {
  const match = id.match(/^(.+)-[^-]+$/);
  return match?.[1] ?? "";
}

function collectorNumber(value: string): string {
  const firstPart = value.split("/")[0] ?? value;
  return firstPart.replace(/[^a-z0-9]/gi, "").replace(/^0+(?=\d)/, "");
}

function asciiName(name: string): string {
  if (/[\u3040-\u30ff\u3400-\u9fff]/.test(name)) {
    return "";
  }

  return /[a-z]/i.test(name) ? name : "";
}

function normalizeSetId(setId: string): string {
  return setId.trim().toLowerCase();
}

function shouldUseCodeOnlySearch(
  card: CardmarketSearchCard,
  filters: CardmarketUrlFilters,
): boolean {
  const setId = normalizeSetId(card.setId ?? setIdFromCardId(card.id ?? ""));
  const language = filters.language;
  const isAsianLanguage =
    language === "ja" ||
    language === "ko" ||
    language === "zh-tw" ||
    language === "zh-cn";
  const isJapaneseStyleSet =
    /^sv\d+[a-z]?$/i.test(setId) ||
    /^s\d+[a-z]?$/i.test(setId) ||
    /^[a-z]+\d+[a-z]?$/i.test(setId);

  return Boolean(isAsianLanguage && isJapaneseStyleSet);
}

function cardmarketWebsiteFilterParams(filters: CardmarketUrlFilters): string[] {
  const params: string[] = [];
  const languageId = filters.language
    ? CARDMARKET_LANGUAGE_IDS[filters.language]
    : undefined;
  const conditionId = filters.minCondition
    ? CARDMARKET_CONDITION_IDS[filters.minCondition]
    : undefined;

  if (languageId) {
    params.push(`language=${languageId}`);
  }

  if (conditionId) {
    params.push(`minCondition=${conditionId}`);
  }

  return params;
}
