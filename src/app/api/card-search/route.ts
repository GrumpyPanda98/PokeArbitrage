import { searchTcgDexCards } from "@/lib/tcgdex";
import type { CardLanguage, LanguageBucket } from "@/lib/calculations";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const languageBucket = optionalLanguageBucket(url.searchParams.get("bucket"));
  const preferredLanguage = optionalCardLanguage(url.searchParams.get("language"));
  if (query.trim().length < 2) {
    return Response.json([]);
  }

  try {
    const results = await searchTcgDexCards(query, {
      languageBucket,
      preferredLanguage,
    });
    return Response.json(results);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Card search failed." },
      { status: 500 },
    );
  }
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
