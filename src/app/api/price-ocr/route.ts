import { extractYenPrices, pickBestYenPrice } from "@/lib/ocr";

export const dynamic = "force-dynamic";

type LocalPriceOcrResponse = {
  prices?: unknown;
  source?: unknown;
  text?: unknown;
  warning?: unknown;
  yenPrice?: unknown;
};

const DEFAULT_PRICE_OCR_URL = "http://127.0.0.1:8765/ocr-price";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return Response.json(
        { error: "Upload an image file in the file field." },
        { status: 400 },
      );
    }

    if (!file.type.startsWith("image/")) {
      return Response.json({ error: "Upload an image file." }, { status: 400 });
    }

    if (file.size > MAX_IMAGE_BYTES) {
      return Response.json(
        { error: "Image is too large. Use a photo under 10 MB." },
        { status: 400 },
      );
    }

    const serviceUrl = process.env.PRICE_OCR_URL ?? DEFAULT_PRICE_OCR_URL;
    const upstreamBody = new FormData();
    upstreamBody.append("file", file);

    const response = await fetchWithTimeout(serviceUrl, {
      method: "POST",
      body: upstreamBody,
    });

    if (!response.ok) {
      return Response.json(
        { error: `Local GPU price OCR returned ${response.status}.` },
        { status: 502 },
      );
    }

    const data = (await response.json()) as LocalPriceOcrResponse;
    const text = typeof data.text === "string" ? data.text : "";
    const prices = numericArray(data.prices);
    const parsedPrices = prices.length > 0 ? prices : extractYenPrices(text);
    const yenPrice =
      numberOrUndefined(data.yenPrice) ?? pickBestYenPrice(text) ?? parsedPrices[0];

    return Response.json({
      prices: parsedPrices,
      source: data.source === "paddleocr-gpu" ? data.source : "paddleocr-gpu",
      text,
      warning: typeof data.warning === "string" ? data.warning : undefined,
      yenPrice,
    });
  } catch {
    return Response.json(
      { error: "Local GPU price OCR is unavailable." },
      { status: 503 },
    );
  }
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs = 25_000,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function numericArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.map(numberOrUndefined).filter((item): item is number => item !== undefined)
    : [];
}

function numberOrUndefined(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}
