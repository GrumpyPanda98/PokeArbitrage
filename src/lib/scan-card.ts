import type { CardSearchResult } from "./tcgdex";

export type CardScanSource = "gibltcg" | "google-ocr" | "local-ocr";

export type CardScanEvidence = {
  name?: string;
  setCode?: string;
  setName?: string;
  cardNumber?: string;
  language?: "ja" | "en";
  rawText?: string;
  priceYen?: number;
  psaCert?: string;
  giblIdentity?: string;
};

export type CardScanCandidate = {
  query: string;
  confidence: number;
  source: CardScanSource;
  card?: CardSearchResult;
  evidence: CardScanEvidence;
};

export type CardScanResponse = {
  best?: CardScanCandidate;
  candidates: CardScanCandidate[];
  yenPrice?: number;
  psaCert?: string;
  rawText?: string;
  providersTried: CardScanSource[];
  warnings: string[];
};

export async function scanCardImage(file: File): Promise<CardScanResponse> {
  const body = new FormData();
  body.append("file", file);

  const response = await fetch("/api/scan-card", {
    method: "POST",
    body,
  });

  if (!response.ok) {
    throw new Error(`Card scan failed with ${response.status}`);
  }

  return (await response.json()) as CardScanResponse;
}
