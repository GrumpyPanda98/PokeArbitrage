import type { CardSearchResult } from "./tcgdex";

const TCGTRACKING_BASE_URL = "https://tcgtracking.com/tcgapi/v1";
const POKEMON_EN_CATEGORY_ID = 3;
const USD_TO_DKK = 7;

export type TcgTrackingProduct = {
  id: number;
  name: string;
  clean_name?: string;
  number?: string;
  image_url?: string;
  cardmarket_id?: number;
  cardtrader_id?: number;
};

type TcgTrackingSet = {
  id: number;
  name: string;
  abbreviation?: string;
  products?: TcgTrackingProduct[];
};

type TcgTrackingSetResponse = {
  id?: number;
  name?: string;
  abbreviation?: string;
  set_id?: number;
  set_name?: string;
  set_abbr?: string;
  products?: TcgTrackingProduct[];
};

type TcgTrackingPricingResponse = {
  prices?: Record<string, TcgTrackingProductPricing>;
};

type TcgTrackingProductPricing = {
  tcg?: Record<string, TcgTrackingVariantPricing>;
  cardtrader?: Record<string, TcgTrackingVariantPricing>;
};

type TcgTrackingVariantPricing = {
  low?: number;
  market?: number;
  mkt?: number;
};

export async function fetchTcgTrackingSet(
  setId: number,
): Promise<TcgTrackingSet> {
  const response = await fetch(
    `${TCGTRACKING_BASE_URL}/${POKEMON_EN_CATEGORY_ID}/sets/${setId}`,
  );
  if (!response.ok) {
    throw new Error(`TCGTracking set failed with ${response.status}`);
  }

  const data = (await response.json()) as TcgTrackingSetResponse;
  return {
    id: data.id ?? data.set_id ?? setId,
    name: data.name ?? data.set_name ?? "",
    abbreviation: data.abbreviation ?? data.set_abbr,
    products: data.products ?? [],
  };
}

export async function fetchTcgTrackingRawDkk(
  setId: number,
  productId: number,
): Promise<number | undefined> {
  const response = await fetch(
    `${TCGTRACKING_BASE_URL}/${POKEMON_EN_CATEGORY_ID}/sets/${setId}/pricing`,
  );
  if (!response.ok) {
    throw new Error(`TCGTracking pricing failed with ${response.status}`);
  }

  const data = (await response.json()) as TcgTrackingPricingResponse;
  const productPricing = data.prices?.[String(productId)];
  const usd = bestRawUsd(productPricing);
  return usd ? Math.round(usd * USD_TO_DKK) : undefined;
}

export function mapTcgTrackingProductToCard(
  product: TcgTrackingProduct,
  set: { id: number; name: string },
): CardSearchResult {
  return {
    id: `tcgtracking-${product.id}`,
    name: product.clean_name || product.name,
    setName: cleanSetName(set.name),
    cardNumber: product.number || "",
    imageUrl: product.image_url || "",
    language: "en",
    source: "tcgtracking",
    tcgTrackingProductId: product.id,
    tcgTrackingSetId: set.id,
    cardmarketId: product.cardmarket_id,
  };
}

export function cleanSetName(setName: string): string {
  return setName
    .replace(/^[A-Z0-9]+:\s*/i, "")
    .replace(/\s+Trainer Gallery$/i, "")
    .trim();
}

function bestRawUsd(pricing?: TcgTrackingProductPricing): number | undefined {
  if (!pricing) {
    return undefined;
  }

  const variants = [pricing.tcg, pricing.cardtrader].filter(Boolean);
  for (const variantGroup of variants) {
    for (const variant of Object.values(variantGroup ?? {})) {
      const value = variant.market ?? variant.mkt ?? variant.low;
      if (value && value > 0) {
        return value;
      }
    }
  }

  return undefined;
}
