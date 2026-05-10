import type { CardLanguage, LanguageBucket } from "./calculations";
import type { CardSearchResult } from "./tcgdex";

export type { CardSearchResult };

export type CardSearchOptions = {
  languageBucket?: LanguageBucket;
  preferredLanguage?: CardLanguage;
};

const CLIENT_SEARCH_CACHE_TTL_MS = 1000 * 60 * 10;
const clientSearchCache = new Map<
  string,
  { expiresAt: number; promise: Promise<CardSearchResult[]> }
>();

export async function searchCards(
  query: string,
  options: CardSearchOptions = {},
): Promise<CardSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return [];
  }

  const params = new URLSearchParams({ q: trimmed });
  if (options.languageBucket) {
    params.set("bucket", options.languageBucket);
  }
  if (options.preferredLanguage) {
    params.set("language", options.preferredLanguage);
  }

  const cacheKey = params.toString();
  const cached = clientSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.promise;
  }

  const promise = fetch(`/api/card-search?${cacheKey}`)
    .then((response) => {
      if (!response.ok) {
        return [];
      }

      return response.json() as Promise<CardSearchResult[]>;
    })
    .catch(() => []);

  clientSearchCache.set(cacheKey, {
    expiresAt: Date.now() + CLIENT_SEARCH_CACHE_TTL_MS,
    promise,
  });

  return promise;
}
