import { searchTcgDexCards } from "@/lib/tcgdex";
import type { CardLanguage, LanguageBucket } from "@/lib/calculations";

export const dynamic = "force-dynamic";

const SEARCH_CACHE_TTL_MS = 1000 * 60 * 10;
const searchCache = new Map<
  string,
  { expiresAt: number; promise: Promise<Response> }
>();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const languageBucket = optionalLanguageBucket(url.searchParams.get("bucket"));
  const preferredLanguage = optionalCardLanguage(url.searchParams.get("language"));
  if (query.trim().length < 2) {
    return Response.json([]);
  }

  const cacheKey = JSON.stringify({
    languageBucket,
    preferredLanguage,
    query: query.trim().toLowerCase(),
  });
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return (await cached.promise).clone();
  }

  try {
    const promise = searchTcgDexCards(query, {
      languageBucket,
      preferredLanguage,
    }).then((results) => searchResponse(results));
    searchCache.set(cacheKey, {
      expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
      promise,
    });

    return (await promise).clone();
  } catch (error) {
    searchCache.delete(cacheKey);
    return Response.json(
      { error: error instanceof Error ? error.message : "Card search failed." },
      { status: 500 },
    );
  }
}

function searchResponse(results: unknown): Response {
  return Response.json(results, {
    headers: {
      "Cache-Control": `private, max-age=${Math.round(SEARCH_CACHE_TTL_MS / 1000)}`,
    },
  });
}

function optionalLanguageBucket(value: string | null): LanguageBucket | undefined {
  return value === "asian" || value === "western" ? value : undefined;
}

function optionalCardLanguage(value: string | null): CardLanguage | undefined {
  const languages: CardLanguage[] = [
    "en",
    "fr",
    "de",
    "es",
    "it",
    "pt",
    "ja",
    "ko",
    "zh-tw",
    "zh-cn",
  ];
  return languages.includes(value as CardLanguage)
    ? (value as CardLanguage)
    : undefined;
}
