export type InHandCondition = "raw" | "psa9" | "psa10";

export type CardmarketConditionCode =
  | "MT"
  | "NM"
  | "EX"
  | "GD"
  | "LP"
  | "PL"
  | "PO";

export type RawCardCondition = CardmarketConditionCode;

export type LanguageBucket = "asian" | "western";

export type CardLanguage =
  | "en"
  | "fr"
  | "de"
  | "es"
  | "it"
  | "pt"
  | "ja"
  | "ko"
  | "zh-tw"
  | "zh-cn";

export type Decision = "BUY" | "MAYBE" | "SKIP";

export type CalculationDisplayState = "idle" | "missing" | "ready";

export type DealRouteId =
  | "raw_flip"
  | "grade_psa9"
  | "grade_psa10"
  | "psa9_slab"
  | "psa10_slab";

export type ReferenceSource =
  | "cardmarket"
  | "ebay"
  | "pricecharting"
  | "pokeprices"
  | "tcgplayer"
  | "manual";

export type ReferenceValues = {
  rawDkk?: number;
  psa7Dkk?: number;
  psa8Dkk?: number;
  psa9Dkk?: number;
  psa95Dkk?: number;
  psa10Dkk?: number;
  rawSource?: ReferenceSource;
  rawFilterStatus?:
    | "live_filtered"
    | "filtered"
    | "fetching_filtered"
    | "filtered_unavailable"
    | "aggregate"
    | "manual";
  rawPriceNote?: string;
  psa7Source?: ReferenceSource;
  psa8Source?: ReferenceSource;
  psa9Source?: ReferenceSource;
  psa95Source?: ReferenceSource;
  psa10Source?: ReferenceSource;
  sources: ReferenceSource[];
  sourceUrls?: Partial<Record<ReferenceSource, string>>;
  fetchedAt?: string;
  isManualOverride?: boolean;
};

export type DealWarning =
  | "PSA_10_TRAP"
  | "HIGH_END_RISK"
  | "VALUES_MISSING"
  | "MANUAL_VALUES"
  | null;

export type Settings = {
  yenDivisor: number;
  sellingFee: number;
  buyThreshold: number;
  maybeThreshold: number;
  gradingFeeDkk: number;
};

export type ReferencePriceFilters = {
  cardLanguage?: CardLanguage;
  languageBucket?: LanguageBucket;
  minCondition?: RawCardCondition;
};

export type MarginResult = {
  netDkk?: number;
  profitDkk?: number;
  marginPercent?: number;
};

export type DealCalculation = MarginResult & {
  costDkk: number;
  displayState: CalculationDisplayState;
  referenceValueUsedDkk?: number;
  netReferenceValueDkk?: number;
  decision: Decision;
  warning: DealWarning;
  route?: DealRouteResult;
  routes: DealRouteResult[];
  raw?: MarginResult;
  psa7?: MarginResult;
  psa8?: MarginResult;
  psa9?: MarginResult;
  psa95?: MarginResult;
  psa10?: MarginResult;
};

export type DealRouteResult = MarginResult & {
  id: DealRouteId;
  label: string;
  costDkk: number;
  decision: Decision;
  displayState: CalculationDisplayState;
  highEndCapped: boolean;
  referenceValueDkk?: number;
};

export type DealStatus = "seen" | "bought" | "skipped";

export type Deal = {
  id: string;
  cardName: string;
  setName?: string;
  cardNumber?: string;
  imageUrl?: string;
  inHandCondition: InHandCondition;
  rawCondition?: RawCardCondition;
  languageBucket?: LanguageBucket;
  cardLanguage?: CardLanguage;
  shopPriceYen: number;
  costDkk: number;
  referenceValueUsedDkk?: number;
  netReferenceValueDkk?: number;
  rawMarketDkk?: number;
  psa7MarketDkk?: number;
  psa8MarketDkk?: number;
  psa9MarketDkk?: number;
  psa95MarketDkk?: number;
  psa10MarketDkk?: number;
  profitDkk?: number;
  marginPercent?: number;
  decision: Decision;
  warning?: DealWarning;
  store?: string;
  city?: string;
  notes?: string;
  status: DealStatus;
  createdAt: string;
};

export const DEFAULT_SETTINGS: Settings = {
  yenDivisor: 25,
  sellingFee: 0.05,
  buyThreshold: 30,
  maybeThreshold: 15,
  gradingFeeDkk: 220,
};

const HIGH_END_COST_DKK = 3250;

const ROUTE_THRESHOLDS: Record<
  "raw_flip" | "raw_grade" | "slab",
  { buy: number; maybe: number }
> = {
  raw_flip: { buy: 30, maybe: 20 },
  raw_grade: { buy: 45, maybe: 35 },
  slab: { buy: 20, maybe: 10 },
};

export const CONDITION_LABELS: Record<InHandCondition, string> = {
  raw: "Raw",
  psa9: "PSA 9",
  psa10: "PSA 10",
};

export const RAW_CONDITION_OPTIONS: RawCardCondition[] = [
  "MT",
  "NM",
  "EX",
  "GD",
  "LP",
  "PL",
  "PO",
];

export const RAW_CONDITION_LABELS: Record<RawCardCondition, string> = {
  MT: "Mint",
  NM: "Near Mint",
  EX: "Excellent",
  GD: "Good",
  LP: "Light Played",
  PL: "Played",
  PO: "Poor",
};

export const LANGUAGE_BUCKET_LABELS: Record<LanguageBucket, string> = {
  asian: "Asian",
  western: "Western",
};

export const CARD_LANGUAGE_LABELS: Record<CardLanguage, string> = {
  en: "English",
  fr: "French",
  de: "German",
  es: "Spanish",
  it: "Italian",
  pt: "Portuguese",
  ja: "Japanese",
  ko: "Korean",
  "zh-tw": "Traditional Chinese",
  "zh-cn": "Simplified Chinese",
};

export const CARDMARKET_LANGUAGE_IDS: Record<CardLanguage, number> = {
  en: 1,
  fr: 2,
  de: 3,
  es: 4,
  it: 5,
  "zh-cn": 6,
  ja: 7,
  pt: 8,
  ko: 10,
  "zh-tw": 11,
};

export const CARDMARKET_CONDITION_IDS: Record<RawCardCondition, number> = {
  MT: 1,
  NM: 2,
  EX: 3,
  GD: 4,
  LP: 5,
  PL: 6,
  PO: 7,
};

export function normalizeRawCondition(
  value: string | null | undefined,
): RawCardCondition {
  const normalized = String(value ?? "").trim();
  const upper = normalized.toUpperCase();

  if (RAW_CONDITION_OPTIONS.includes(upper as RawCardCondition)) {
    return upper as RawCardCondition;
  }

  const legacy: Record<string, RawCardCondition> = {
    damaged: "PO",
    heavy_play: "PO",
    light_play: "LP",
    mint: "MT",
    moderate_play: "PL",
    near_mint: "NM",
  };

  return legacy[normalized] ?? "NM";
}

export function cleanNumber(value: string | number | null | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (!value) {
    return 0;
  }

  const compact = value.replace(/[^\d.,-]/g, "");
  const hasComma = compact.includes(",");
  const hasDot = compact.includes(".");
  let normalized = compact;

  if (hasComma && hasDot) {
    normalized =
      compact.lastIndexOf(".") > compact.lastIndexOf(",")
        ? compact.replaceAll(",", "")
        : compact.replaceAll(".", "").replace(",", ".");
  } else if (hasComma) {
    normalized = /^\d{1,3}(,\d{3})+$/.test(compact)
      ? compact.replaceAll(",", "")
      : compact.replace(",", ".");
  } else if (hasDot && /^\d{1,3}(\.\d{3})+$/.test(compact)) {
    normalized = compact.replaceAll(".", "");
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function optionalNumber(
  value: string | number | null | undefined,
): number | undefined {
  const parsed = cleanNumber(value);
  return parsed > 0 ? parsed : undefined;
}

export function calculateCostDkk(
  shopPriceYen: number,
  settings: Settings = DEFAULT_SETTINGS,
): number {
  const resolvedSettings = normalizeSettings(settings);
  if (shopPriceYen <= 0 || resolvedSettings.yenDivisor <= 0) {
    return 0;
  }

  return shopPriceYen / resolvedSettings.yenDivisor;
}

export function getReferenceValueForCondition(
  condition: InHandCondition,
  values: ReferenceValues,
): number | undefined {
  if (condition === "raw") return values.rawDkk;
  if (condition === "psa9") return values.psa9Dkk;
  if (condition === "psa10") return values.psa10Dkk;
  return undefined;
}

export function decideFromMargin(
  marginPercent: number,
  settings: Settings = DEFAULT_SETTINGS,
): Decision {
  if (marginPercent >= settings.buyThreshold) return "BUY";
  if (marginPercent >= settings.maybeThreshold) return "MAYBE";
  return "SKIP";
}

export function calculateMargin(
  marketValueDkk: number | undefined,
  costDkk: number,
  settings: Settings = DEFAULT_SETTINGS,
): MarginResult {
  const resolvedSettings = normalizeSettings(settings);
  if (!marketValueDkk || !costDkk) {
    return {
      netDkk: undefined,
      profitDkk: undefined,
      marginPercent: undefined,
    };
  }

  const netDkk = marketValueDkk * (1 - resolvedSettings.sellingFee);
  const profitDkk = netDkk - costDkk;
  const marginPercent = (profitDkk / costDkk) * 100;

  return {
    netDkk,
    profitDkk,
    marginPercent,
  };
}

export function calculateDeal(
  condition: InHandCondition,
  shopPriceYen: number,
  values: ReferenceValues,
  settings: Settings = DEFAULT_SETTINGS,
): DealCalculation {
  const resolvedSettings = normalizeSettings(settings);
  const costDkk = calculateCostDkk(shopPriceYen, resolvedSettings);
  const routes = calculateDealRoutes(condition, costDkk, values, resolvedSettings);
  const selectedRoute = selectBestRoute(routes);
  const referenceValue = selectedRoute?.referenceValueDkk;
  const selected = {
    netDkk: selectedRoute?.netDkk,
    profitDkk: selectedRoute?.profitDkk,
    marginPercent: selectedRoute?.marginPercent,
  };
  const displayState: CalculationDisplayState =
    shopPriceYen <= 0 || costDkk <= 0
      ? "idle"
      : !selectedRoute || selectedRoute.marginPercent === undefined
        ? "missing"
        : "ready";

  const decision: Decision = selectedRoute?.decision ?? "SKIP";
  let warning: DealWarning = null;

  if (displayState === "missing") {
    warning = "VALUES_MISSING";
  }

  const raw = routeMargin(routes.find((route) => route.id === "raw_flip"));
  const psa7 = calculateMargin(values.psa7Dkk, costDkk, resolvedSettings);
  const psa8 = calculateMargin(values.psa8Dkk, costDkk, resolvedSettings);
  const psa9 = routeMargin(
    routes.find((route) => route.id === "grade_psa9" || route.id === "psa9_slab"),
  );
  const psa95 = calculateMargin(values.psa95Dkk, costDkk, resolvedSettings);
  const psa10 = routeMargin(
    routes.find((route) => route.id === "grade_psa10" || route.id === "psa10_slab"),
  );

  if (condition === "raw") {
    const rawPoor =
      raw.marginPercent === undefined ||
      raw.marginPercent < ROUTE_THRESHOLDS.raw_flip.maybe;
    const psa9Bad =
      psa9.marginPercent === undefined ||
      psa9.marginPercent < ROUTE_THRESHOLDS.raw_grade.maybe;
    const psa10Good =
      psa10.marginPercent !== undefined &&
      psa10.marginPercent >= ROUTE_THRESHOLDS.raw_grade.buy;

    if (rawPoor && psa9Bad && psa10Good) {
      warning = "PSA_10_TRAP";
    }
  }

  if (!warning && selectedRoute?.highEndCapped) {
    warning = "HIGH_END_RISK";
  }

  if (values.isManualOverride && !warning) {
    warning = "MANUAL_VALUES";
  }

  return {
    costDkk,
    displayState,
    referenceValueUsedDkk: referenceValue,
    netReferenceValueDkk: selected.netDkk,
    profitDkk: selected.profitDkk,
    marginPercent: selected.marginPercent,
    decision,
    warning,
    route: selectedRoute,
    routes,
    raw,
    psa7,
    psa8,
    psa9,
    psa95,
    psa10,
  };
}

export function calculateDealRoutes(
  condition: InHandCondition,
  costDkk: number,
  values: ReferenceValues,
  settings: Settings = DEFAULT_SETTINGS,
): DealRouteResult[] {
  const resolvedSettings = normalizeSettings(settings);
  const gradingCostDkk = costDkk > 0 ? resolvedSettings.gradingFeeDkk : 0;

  if (condition === "psa9") {
    return [
      calculateRoute(
        "psa9_slab",
        "PSA 9 slab",
        values.psa9Dkk,
        costDkk,
        ROUTE_THRESHOLDS.slab,
        resolvedSettings,
      ),
    ];
  }

  if (condition === "psa10") {
    return [
      calculateRoute(
        "psa10_slab",
        "PSA 10 slab",
        values.psa10Dkk,
        costDkk,
        ROUTE_THRESHOLDS.slab,
        resolvedSettings,
      ),
    ];
  }

  return [
    calculateRoute(
      "raw_flip",
      "Raw flip",
      values.rawDkk,
      costDkk,
      ROUTE_THRESHOLDS.raw_flip,
      resolvedSettings,
    ),
    calculateRoute(
      "grade_psa9",
      "Grade PSA 9",
      values.psa9Dkk,
      costDkk + gradingCostDkk,
      ROUTE_THRESHOLDS.raw_grade,
      resolvedSettings,
    ),
    calculateRoute(
      "grade_psa10",
      "Grade PSA 10",
      values.psa10Dkk,
      costDkk + gradingCostDkk,
      ROUTE_THRESHOLDS.raw_grade,
      resolvedSettings,
    ),
  ];
}

function calculateRoute(
  id: DealRouteId,
  label: string,
  referenceValueDkk: number | undefined,
  routeCostDkk: number,
  thresholds: { buy: number; maybe: number },
  settings: Settings,
): DealRouteResult {
  const margin = calculateMargin(referenceValueDkk, routeCostDkk, settings);
  const displayState: CalculationDisplayState =
    routeCostDkk <= 0
      ? "idle"
      : margin.marginPercent === undefined
        ? "missing"
        : "ready";
  const uncappedDecision =
    margin.marginPercent === undefined
      ? "SKIP"
      : decideFromRouteMargin(margin.marginPercent, thresholds);
  const highEndCapped =
    routeCostDkk > HIGH_END_COST_DKK && uncappedDecision === "BUY";

  return {
    ...margin,
    id,
    label,
    costDkk: routeCostDkk,
    decision: highEndCapped ? "MAYBE" : uncappedDecision,
    displayState,
    highEndCapped,
    referenceValueDkk,
  };
}

function selectBestRoute(routes: DealRouteResult[]): DealRouteResult | undefined {
  const readyRoutes = routes.filter(
    (route) => route.displayState === "ready" && route.marginPercent !== undefined,
  );

  if (readyRoutes.length === 0) {
    return undefined;
  }

  return readyRoutes.sort(
    (left, right) =>
      decisionRank(right.decision) - decisionRank(left.decision) ||
      (right.marginPercent ?? -Infinity) - (left.marginPercent ?? -Infinity),
  )[0];
}

function routeMargin(route: DealRouteResult | undefined): MarginResult {
  return {
    netDkk: route?.netDkk,
    profitDkk: route?.profitDkk,
    marginPercent: route?.marginPercent,
  };
}

function decideFromRouteMargin(
  marginPercent: number,
  thresholds: { buy: number; maybe: number },
): Decision {
  if (marginPercent >= thresholds.buy) return "BUY";
  if (marginPercent >= thresholds.maybe) return "MAYBE";
  return "SKIP";
}

function decisionRank(decision: Decision): number {
  if (decision === "BUY") return 3;
  if (decision === "MAYBE") return 2;
  return 1;
}

export function normalizeSettings(settings: Partial<Settings> | Settings): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    gradingFeeDkk:
      settings.gradingFeeDkk !== undefined
        ? settings.gradingFeeDkk
        : DEFAULT_SETTINGS.gradingFeeDkk,
  };
}

export function formatMoney(
  value: number | undefined,
  currency = "DKK",
): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "—";
  }

  return `${new Intl.NumberFormat("da-DK", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(value)} ${currency}`;
}

export function formatSignedMoney(
  value: number | undefined,
  currency = "DKK",
): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "—";
  }

  const sign = value > 0 ? "+" : "";
  return `${sign}${formatMoney(value, currency)}`;
}

export function formatPercent(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "—";
  }

  const sign = value > 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat("da-DK", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }).format(value)}%`;
}

export function formatYen(value: number): string {
  return `¥${new Intl.NumberFormat("ja-JP", {
    maximumFractionDigits: 0,
  }).format(value)}`;
}
