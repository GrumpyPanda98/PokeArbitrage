import { fetchReferencePricesServer } from "@/lib/reference-prices.server";
import type { ReferencePriceFilters } from "@/lib/calculations";
import type { CardSearchResult } from "@/lib/tcgdex";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as
      | CardSearchResult
      | { card?: CardSearchResult; filters?: ReferencePriceFilters };
    const isWrapped = isReferencePriceRequest(body);
    const card = isWrapped ? body.card : body;
    const filters = isWrapped ? body.filters : undefined;
    if (!card?.id || !card.name) {
      return Response.json({ error: "Missing card identity." }, { status: 400 });
    }

    const values = await fetchReferencePricesServer(card, filters);
    return Response.json(values);
  } catch {
    return Response.json(
      { error: "Could not fetch reference prices." },
      { status: 500 },
    );
  }
}

function isReferencePriceRequest(
  value: CardSearchResult | { card?: CardSearchResult; filters?: ReferencePriceFilters },
): value is { card?: CardSearchResult; filters?: ReferencePriceFilters } {
  return typeof value === "object" && value !== null && "card" in value;
}
