import {
  fetchCardmarketLiveReferenceValues,
  type CardmarketLivePriceRequest,
} from "@/lib/cardmarket-live";
import type { ReferencePriceFilters } from "@/lib/calculations";
import type { CardSearchResult } from "@/lib/tcgdex";

export const dynamic = "force-dynamic";

type RawPriceRouteRequest =
  | {
      card?: CardSearchResult;
      filters?: ReferencePriceFilters;
    }
  | CardmarketLivePriceRequest;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RawPriceRouteRequest;

    if (isWrappedCardRequest(body)) {
      if (!body.card?.id || !body.card.name) {
        return Response.json(
          { error: "Missing card identity." },
          { status: 400 },
        );
      }

      const values = await fetchCardmarketLiveReferenceValues(
        body.card,
        body.filters,
      );
      return Response.json(values);
    }

    return Response.json(
      { error: "Use /api/reference-prices or send { card, filters }." },
      { status: 400 },
    );
  } catch {
    return Response.json(
      { error: "Could not fetch live Cardmarket price." },
      { status: 500 },
    );
  }
}

function isWrappedCardRequest(
  value: RawPriceRouteRequest,
): value is { card?: CardSearchResult; filters?: ReferencePriceFilters } {
  return typeof value === "object" && value !== null && "card" in value;
}
