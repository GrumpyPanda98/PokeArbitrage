import { describe, expect, it } from "vitest";
import {
  mergeScanCandidates,
  selectAutoScanCandidate,
} from "./scan-merge";
import type { CardScanCandidate } from "./scan-card";
import type { CardSearchResult } from "./tcgdex";

describe("scan result merging", () => {
  it("keeps cloud card candidates ahead of weaker local OCR candidates", () => {
    const cloud = candidate("gibltcg", 0.92, card("SV2a-175", "Psyduck"));
    const local = candidate("local-ocr", 0.5, card("SV2a-175", "Psyduck"));

    const merged = mergeScanCandidates([cloud], [local]);

    expect(merged).toEqual([cloud]);
    expect(selectAutoScanCandidate(merged)).toBe(cloud);
  });

  it("supplements cloud results with local OCR candidates", () => {
    const cloud = candidate("gibltcg", 0.92, card("SV2a-175", "Psyduck"));
    const local = candidate("local-ocr", 0.5, card("SV2a-176", "Poliwhirl"));

    expect(mergeScanCandidates([cloud], [local])).toEqual([cloud, local]);
  });

  it("does not auto-select local OCR-only matches", () => {
    const local = candidate("local-ocr", 0.5, card("SV2a-175", "Psyduck"));

    expect(selectAutoScanCandidate([local])).toBeUndefined();
  });
});

function candidate(
  source: CardScanCandidate["source"],
  confidence: number,
  card: CardSearchResult,
): CardScanCandidate {
  return {
    card,
    confidence,
    evidence: {},
    query: card.name,
    source,
  };
}

function card(id: string, name: string): CardSearchResult {
  return {
    cardNumber: id.split("-").at(-1) ?? "",
    id,
    imageUrl: "",
    language: "ja",
    name,
    setName: "Pokemon Card 151",
    source: "tcgdex",
    tcgDexSetId: "SV2a",
  };
}
