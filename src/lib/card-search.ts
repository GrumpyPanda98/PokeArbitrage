import type { CardLanguage, LanguageBucket } from "./calculations";
import type { CardSearchResult } from "./tcgdex";

export type { CardSearchResult };

export type CardSearchOptions = {
  languageBucket?: LanguageBucket;
  preferredLanguage?: CardLanguage;
};

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

  const response = await fetch(`/api/card-search?${params.toString()}`);
  if (!response.ok) {
    return [];
  }

  return (await response.json()) as CardSearchResult[];
}
