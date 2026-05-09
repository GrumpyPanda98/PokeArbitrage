export function pickRepresentativeMarketPrice(
  values: Array<number | null | undefined>,
): number | undefined {
  const positiveValues = values
    .filter((value): value is number => isPositiveFiniteNumber(value))
    .sort((a, b) => a - b);

  if (positiveValues.length === 0) {
    return undefined;
  }

  return positiveValues[Math.floor(positiveValues.length / 2)];
}

export function pickOrderedMarketPrice(
  values: Array<number | null | undefined>,
): number | undefined {
  return values.find((value): value is number => isPositiveFiniteNumber(value));
}

export function pickVariantMarketPrice(
  primaryValues: Array<number | null | undefined>,
  alternateValues: Array<number | null | undefined>,
): number | undefined {
  const primary = pickOrderedMarketPrice(primaryValues);
  const alternate = pickOrderedMarketPrice(alternateValues);

  if (!primary) {
    return alternate;
  }

  if (!alternate) {
    return primary;
  }

  const alternateLooksLikeActualVariant =
    alternate >= 1 && alternate >= primary * 3;

  return alternateLooksLikeActualVariant ? alternate : primary;
}

function isPositiveFiniteNumber(
  value: number | null | undefined,
): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
