import type { ReferencePriceFilters, ReferenceValues } from "./calculations";
import type { CardSearchResult } from "./tcgdex";

export async function fetchReferencePrices(
  card: CardSearchResult,
  filters: ReferencePriceFilters = {},
): Promise<ReferenceValues> {
  const response = await fetch("/api/reference-prices", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ card, filters }),
  });

  if (!response.ok) {
    return {
      sources: [],
      fetchedAt: new Date().toISOString(),
    };
  }

  return (await response.json()) as ReferenceValues;
}
