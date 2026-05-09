import type { CardScanCandidate } from "./scan-card";

export function mergeScanCandidates(
  cloudCandidates: CardScanCandidate[],
  localCandidates: CardScanCandidate[],
): CardScanCandidate[] {
  const merged: CardScanCandidate[] = [];
  const seen = new Set<string>();

  for (const candidate of [...cloudCandidates, ...localCandidates]) {
    const key = candidate.card
      ? `card:${candidate.card.id}`
      : `query:${candidate.source}:${candidate.query}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(candidate);
  }

  return merged;
}

export function selectAutoScanCandidate(
  candidates: CardScanCandidate[],
  confidenceThreshold = 0.8,
): CardScanCandidate | undefined {
  return candidates.find(
    (candidate) =>
      candidate.source !== "local-ocr" &&
      Boolean(candidate.card) &&
      candidate.confidence >= confidenceThreshold,
  );
}
