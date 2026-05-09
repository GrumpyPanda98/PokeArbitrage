import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import {
  CARDMARKET_CONDITION_IDS,
  CARDMARKET_LANGUAGE_IDS,
  RAW_CONDITION_LABELS,
  RAW_CONDITION_OPTIONS,
  type RawCardCondition,
  type ReferencePriceFilters,
  type ReferenceValues,
} from "./calculations";
import {
  buildCardmarketSearchQuery,
  buildCardmarketSearchUrl,
} from "./cardmarket-url";
import type { CardSearchResult } from "./tcgdex";

const EUR_TO_DKK = 7.46;
const DEFAULT_SIDECAR_URL = "http://127.0.0.1:8766/cardmarket/raw-price";
const DEFAULT_TIMEOUT_MS = 12_000;
const SIDECAR_START_TIMEOUT_MS = 15_000;

let sidecarStartPromise: Promise<void> | undefined;

export type CardmarketLivePriceRequest = {
  cardName: string;
  cardNumber: string;
  idProduct?: number;
  language?: string;
  languageId?: number;
  minCondition?: string;
  minConditionId?: number;
  query: string;
  searchUrl: string;
  setId?: string;
  setName?: string;
};

export type CardmarketLivePriceResponse = {
  condition?: string;
  exactConditionListingCount?: number;
  exactConditionMatched?: boolean;
  error?: string;
  listingCount?: number;
  listingUrl?: string;
  ok?: boolean;
  productUrl?: string;
  query?: string;
  rawEur?: number;
  requestedCondition?: string;
  searchUrl?: string;
  seller?: string;
};

export function buildCardmarketLivePriceRequest(
  card: CardSearchResult,
  filters: ReferencePriceFilters = {},
): CardmarketLivePriceRequest {
  const searchCard = {
    cardNumber: card.cardNumber,
    id: card.id,
    idProduct: card.cardmarketId,
    name: card.name,
    setId:
      card.tcgDexSetId ??
      card.pokemonTcgSetId ??
      setIdFromCardId(card.id),
    setName: card.setName,
  };
  const urlFilters = {
    language: filters.cardLanguage,
    minCondition: filters.minCondition,
  };

  return {
    cardName: card.name,
    cardNumber: card.cardNumber,
    idProduct: card.cardmarketId,
    language: filters.cardLanguage,
    languageId: filters.cardLanguage
      ? CARDMARKET_LANGUAGE_IDS[filters.cardLanguage]
      : undefined,
    minCondition: filters.minCondition,
    minConditionId: filters.minCondition
      ? CARDMARKET_CONDITION_IDS[filters.minCondition]
      : undefined,
    query: buildCardmarketSearchQuery(searchCard, urlFilters),
    searchUrl: buildCardmarketSearchUrl(searchCard, urlFilters),
    setId: searchCard.setId,
    setName: card.setName,
  };
}

export async function fetchCardmarketLiveReferenceValues(
  card: CardSearchResult,
  filters: ReferencePriceFilters = {},
): Promise<ReferenceValues> {
  if (process.env.CARDMARKET_LIVE_ENABLED !== "true") {
    return emptyValues();
  }

  const request = buildCardmarketLivePriceRequest(card, filters);
  const sidecarUrl = process.env.CARDMARKET_SIDECAR_URL ?? DEFAULT_SIDECAR_URL;
  const response =
    (await postSidecarRequest(sidecarUrl, request)) ??
    (await retryAfterStartingSidecar(sidecarUrl, request));

  if (!response?.ok) {
    return emptyValues();
  }

  const data = (await response.json()) as CardmarketLivePriceResponse;
  return mapCardmarketLiveResponseToReferenceValues(
    data,
    request.searchUrl,
    request.minCondition,
  );
}

async function postSidecarRequest(
  sidecarUrl: string,
  request: CardmarketLivePriceRequest,
): Promise<Response | undefined> {
  try {
    return await fetchWithTimeout(
      sidecarUrl,
      {
        body: JSON.stringify(request),
        cache: "no-store",
        headers: { "content-type": "application/json" },
        method: "POST",
      },
      timeoutMs(),
    );
  } catch {
    return undefined;
  }
}

async function retryAfterStartingSidecar(
  sidecarUrl: string,
  request: CardmarketLivePriceRequest,
): Promise<Response | undefined> {
  if (!shouldAutoStartSidecar(sidecarUrl)) {
    return undefined;
  }

  try {
    await ensureSidecarStarted(sidecarUrl);
    return await postSidecarRequest(sidecarUrl, request);
  } catch {
    return undefined;
  }
}

export function mapCardmarketLiveResponseToReferenceValues(
  data: CardmarketLivePriceResponse,
  fallbackUrl: string,
  requestedCondition?: string,
): ReferenceValues {
  if (!data.ok || !isPositiveNumber(data.rawEur)) {
    return emptyValues();
  }

  const sourceUrl = data.productUrl ?? data.searchUrl ?? fallbackUrl;
  const listingCondition = normalizedCondition(data.condition);
  const selectedCondition = normalizedCondition(
    requestedCondition ?? data.requestedCondition,
  );
  const listingNote =
    data.listingCount && data.listingCount > 1
      ? `${data.listingCount} matching listings`
      : "1 matching listing";
  const exactConditionNote =
    data.exactConditionListingCount !== undefined
      ? `${data.exactConditionListingCount} exact-condition listings`
      : undefined;
  const conditionNote = liveConditionNote(
    listingNote,
    exactConditionNote,
    listingCondition,
    selectedCondition,
  );

  return {
    rawDkk: Math.round(data.rawEur * EUR_TO_DKK),
    rawSource: "cardmarket",
    rawFilterStatus: "live_filtered",
    rawPriceNote: conditionNote,
    sources: ["cardmarket"],
    sourceUrls: { cardmarket: sourceUrl },
    fetchedAt: new Date().toISOString(),
  };
}

function emptyValues(): ReferenceValues {
  return {
    sources: [],
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeout: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function timeoutMs(): number {
  const value = Number.parseInt(
    process.env.CARDMARKET_SIDECAR_TIMEOUT_MS ?? "",
    10,
  );
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

function shouldAutoStartSidecar(sidecarUrl: string): boolean {
  if (process.env.CARDMARKET_SIDECAR_AUTO_START === "false") {
    return false;
  }

  try {
    const url = new URL(sidecarUrl);
    return url.hostname === "127.0.0.1" || url.hostname === "localhost";
  } catch {
    return false;
  }
}

async function ensureSidecarStarted(sidecarUrl: string): Promise<void> {
  if (!sidecarStartPromise) {
    sidecarStartPromise = startSidecar(sidecarUrl).catch((error) => {
      sidecarStartPromise = undefined;
      throw error;
    });
  }

  return sidecarStartPromise;
}

async function startSidecar(sidecarUrl: string): Promise<void> {
  const sidecarDir = path.join(process.cwd(), "tools", "cardmarket_server");
  const serverFile = path.join(sidecarDir, "server.py");
  if (!existsSync(serverFile)) {
    throw new Error("Cardmarket sidecar server.py not found.");
  }

  const url = new URL(sidecarUrl);
  const host = url.hostname || "127.0.0.1";
  const port = url.port || "8766";
  const python = sidecarPython(sidecarDir);

  const child = spawn(
    python,
    ["-m", "uvicorn", "server:app", "--host", host, "--port", port],
    {
      cwd: sidecarDir,
      detached: true,
      env: {
        ...process.env,
        PYTHONUTF8: "1",
      },
      stdio: "ignore",
      windowsHide: true,
    },
  );
  child.unref();

  await waitForSidecarHealth(sidecarUrl);
}

async function waitForSidecarHealth(sidecarUrl: string): Promise<void> {
  const healthUrl = healthUrlForSidecar(sidecarUrl);
  const startedAt = Date.now();

  while (Date.now() - startedAt < SIDECAR_START_TIMEOUT_MS) {
    try {
      const response = await fetchWithTimeout(healthUrl, { cache: "no-store" }, 1_000);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the startup timeout elapses.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error("Cardmarket sidecar did not become healthy in time.");
}

function healthUrlForSidecar(sidecarUrl: string): string {
  const url = new URL(sidecarUrl);
  url.pathname = "/health";
  url.search = "";
  return url.toString();
}

function sidecarPython(sidecarDir: string): string {
  if (process.env.CARDMARKET_SIDECAR_PYTHON) {
    return process.env.CARDMARKET_SIDECAR_PYTHON;
  }

  const venvPython = path.join(sidecarDir, ".venv", "Scripts", "python.exe");
  return existsSync(venvPython) ? venvPython : "python";
}

function setIdFromCardId(id: string): string | undefined {
  const match = id.match(/^(.+)-[^-]+$/);
  return match?.[1];
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function liveConditionNote(
  listingNote: string,
  exactConditionNote: string | undefined,
  listingCondition: RawCardCondition | undefined,
  selectedCondition: RawCardCondition | undefined,
): string {
  if (!listingCondition || !selectedCondition) {
    return `Lowest live Cardmarket listing (${listingNote}).`;
  }

  if (listingCondition === selectedCondition) {
    return [
      `Lowest live Cardmarket ${RAW_CONDITION_LABELS[listingCondition]} listing.`,
      exactConditionNote ? `(${exactConditionNote}; ${listingNote}).` : `(${listingNote}).`,
    ].join(" ");
  }

  return `Condition mismatch: cheapest live listing is ${RAW_CONDITION_LABELS[listingCondition]}, not ${RAW_CONDITION_LABELS[selectedCondition]}. Cardmarket filters by minimum condition, so treat this as an upper-bound reference.`;
}

function normalizedCondition(
  value: string | undefined,
): RawCardCondition | undefined {
  const normalized = value?.toUpperCase();
  return RAW_CONDITION_OPTIONS.includes(normalized as RawCardCondition)
    ? (normalized as RawCardCondition)
    : undefined;
}
