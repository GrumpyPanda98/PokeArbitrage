export type PriceOcrSource = "paddleocr-gpu" | "browser-tesseract";

export type PriceOcrCandidate = {
  value: number;
  score?: number;
  text?: string;
  region?: string;
  confidence?: number;
  box?: [number, number, number, number] | null;
};

export type PriceOcrRegion = {
  label: string;
  bbox?: [number, number, number, number] | null;
};

export type PriceOcrResponse = {
  candidates?: PriceOcrCandidate[];
  yenPrice?: number;
  prices: number[];
  regions?: PriceOcrRegion[];
  text?: string;
  source: PriceOcrSource;
  warning?: string;
};

export async function scanPriceImage(file: File): Promise<PriceOcrResponse> {
  const body = new FormData();
  body.append("file", file);

  const response = await fetch("/api/price-ocr", {
    method: "POST",
    body,
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Price OCR failed with ${response.status}`);
  }

  return (await response.json()) as PriceOcrResponse;
}
