import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { access, mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";
import {
  buildScanSearchQueries,
  extractDealScan,
  extractSetCodes,
} from "./ocr";
import {
  parseCardSearchQuery,
  scoreSearchResult,
  searchTcgDexCards,
  type CardSearchResult,
} from "./tcgdex";
import type {
  CardScanCandidate,
  CardScanEvidence,
  CardRecognitionContract,
  CardScanResponse,
  CardScanSource,
} from "./scan-card";

type ProviderExtraction = {
  source: CardScanSource;
  confidence: number;
  evidence: CardScanEvidence;
  queries: string[];
};

type ScoredCandidate = CardScanCandidate & { score: number };

const DEFAULT_PROVIDER_ORDER: CardScanSource[] = [
  "local-image",
  "gibltcg",
];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_SEARCH_QUERIES = 8;
const GIBL_BASE_URL = "https://gibltcg.com/api/v1";
const GIBL_CARD_LIST_TYPES = ["pokemon_japan", "pokemon"];
const execFileAsync = promisify(execFile);

type LocalMatcherResult = {
  card?: {
    id?: string;
    image_url?: string;
    language?: string;
    local_id?: string;
    name?: string;
    set_id?: string;
    set_name?: string;
  };
  embedding_similarity?: number;
  hash_distance?: number;
  histogram_similarity?: number;
  orb_similarity?: number;
  score?: number;
};

type LocalImageScanResult = {
  candidates: CardScanCandidate[];
  recognition?: CardRecognitionContract;
};

export async function scanCardImageServer(file: File): Promise<CardScanResponse> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Upload an image file.");
  }

  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("Image is too large. Use a photo under 10 MB.");
  }

  const providersTried: CardScanSource[] = [];
  const warnings: string[] = [];
  const directCandidates: CardScanCandidate[] = [];
  const extractions: ProviderExtraction[] = [];
  let recognition: CardRecognitionContract | undefined;

  for (const provider of getProviderOrder()) {
    try {
      if (provider === "local-image") {
        providersTried.push(provider);
        const localResult = await scanWithLocalImageMatcher(file);
        directCandidates.push(...localResult.candidates);
        recognition = localResult.recognition ?? recognition;
      }

      if (provider === "gibltcg" && process.env.GIBLTCG_API_KEY) {
        providersTried.push(provider);
        extractions.push(...(await scanWithGiblTcg(file)));
      }

      if (provider === "google-ocr" && process.env.GOOGLE_VISION_API_KEY) {
        providersTried.push(provider);
        const googleExtraction = await scanWithGoogleVision(file);
        if (googleExtraction) {
          extractions.push(googleExtraction);
        }
      }
    } catch (error) {
      warnings.push(providerWarning(provider, error));
    }
  }

  const candidates = mergeScanCandidates([
    ...directCandidates,
    ...(await resolveCandidates(extractions)),
  ]);
  const psaCert = firstString(extractions.map((item) => item.evidence.psaCert));

  if (providersTried.length === 0) {
    warnings.push("No scan providers are configured.");
  }

  if (candidates.length === 0) {
    warnings.push("No card match was found. Search manually.");
  }

  return {
    best: candidates[0],
    candidates,
    psaCert,
    recognition,
    providersTried: uniqueSources(providersTried),
    warnings: uniqueStrings(warnings),
  };
}

async function scanWithLocalImageMatcher(file: File): Promise<LocalImageScanResult> {
  const matcherDir =
    process.env.LOCAL_CARD_MATCHER_DIR ??
    path.join(/*turbopackIgnore: true*/ process.cwd(), "tools", "card_matcher");
  const pythonPath =
    process.env.LOCAL_CARD_MATCHER_PYTHON ??
    path.join(
      matcherDir,
      ".venv",
      process.platform === "win32" ? "Scripts" : "bin",
      process.platform === "win32" ? "python.exe" : "python",
    );
  const cacheDir =
    process.env.LOCAL_CARD_MATCHER_CACHE_DIR ??
    path.join(/*turbopackIgnore: true*/ matcherDir, "cache");
  const indexPath =
    process.env.LOCAL_CARD_MATCHER_INDEX ??
    path.join(cacheDir, "ja_image_index.json");
  const embeddingIndexPath =
    process.env.LOCAL_CARD_MATCHER_EMBEDDING_INDEX ??
    path.join(cacheDir, "ja_embeddings_timm_vit_base_patch16_dinov3.lvd1689m_cls_register_mean.npz");

  await assertPathExists(pythonPath, "Local matcher Python was not found");
  const matcherScript = process.env.LOCAL_CARD_MATCHER_SCRIPT ?? "match_card_v2.py";
  await assertPathExists(
    path.join(/*turbopackIgnore: true*/ matcherDir, matcherScript),
    "Local matcher script was not found",
  );
  await assertPathExists(indexPath, "Local matcher image index was not found");

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pokearb-card-"));
  const tempPath = path.join(tempDir, `scan-${randomUUID()}${extensionForFile(file)}`);

  try {
    await writeFile(tempPath, Buffer.from(await file.arrayBuffer()));

    const args = [
      matcherScript,
      tempPath,
      "--index",
      indexPath,
      "--top",
      String(localMatcherTop()),
      "--json",
    ];

    if (await pathExists(embeddingIndexPath)) {
      args.push(
        "--embedding-index",
        embeddingIndexPath,
        "--device",
        process.env.LOCAL_CARD_MATCHER_DEVICE ?? "cuda",
      );
    }

    if (process.env.LOCAL_CARD_MATCHER_EMBEDDING_POOLING) {
      args.push("--embedding-pooling", process.env.LOCAL_CARD_MATCHER_EMBEDDING_POOLING);
    }

    if (process.env.LOCAL_CARD_MATCHER_DEBUG_DIR) {
      args.push("--debug-dir", process.env.LOCAL_CARD_MATCHER_DEBUG_DIR);
    }

    const { stdout } = await execFileAsync(pythonPath, args, {
      cwd: matcherDir,
      env: {
        ...process.env,
        PYTHONUTF8: "1",
      },
      maxBuffer: 20 * 1024 * 1024,
      timeout: localMatcherTimeoutMs(),
      windowsHide: true,
    });

    return parseLocalMatcherOutput(stdout);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

function localMatcherResultToCandidate(result: LocalMatcherResult): CardScanCandidate {
  const card = result.card ?? {};
  const confidence = clamp(Number(result.score ?? 0), 0.1, 0.99);
  const setId = card.set_id ?? "";
  const localId = card.local_id ?? "";
  const name = card.name ?? "";

  return {
    card: {
      cardNumber: localId,
      id: card.id ?? `${setId}-${localId}`,
      imageUrl: card.image_url ?? "",
      language: card.language ?? "ja",
      name,
      setName: card.set_name ?? "",
      source: "tcgdex",
      tcgDexSetId: setId,
    },
    confidence,
    evidence: {
      canonicalPrintUid: card.id ? result.card?.id : undefined,
      cardNumber: localId,
      language: card.language === "en" ? "en" : "ja",
      name,
      setCode: setId,
      setName: card.set_name,
    },
    query: [setId, localId, name].filter(Boolean).join(" "),
    source: "local-image",
  };
}

function parseLocalMatcherOutput(stdout: string): LocalImageScanResult {
  const parsed = parseJsonPayload(stdout);
  if (Array.isArray(parsed)) {
    return {
      candidates: (parsed.filter(isRecord) as LocalMatcherResult[]).map(
        localMatcherResultToCandidate,
      ),
    };
  }

  if (isRecord(parsed)) {
    const candidates = recordsFromMaybeArray(readPath(parsed, ["candidates"]));
    return {
      candidates: candidates.map((candidate) =>
        localMatcherV2CandidateToCandidate(candidate, parsed),
      ),
      recognition: parsed as CardRecognitionContract,
    };
  }

  return { candidates: [] };
}

function parseJsonPayload(stdout: string): unknown {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const objectStart = stdout.indexOf("{");
    const arrayStart = stdout.indexOf("[");
    const starts = [objectStart, arrayStart].filter((value) => value >= 0);
    if (starts.length === 0) {
      return undefined;
    }

    const start = Math.min(...starts);
    const end = stdout[start] === "{" ? stdout.lastIndexOf("}") : stdout.lastIndexOf("]");
    if (end <= start) {
      return undefined;
    }

    return JSON.parse(stdout.slice(start, end + 1)) as unknown;
  }
}

function localMatcherV2CandidateToCandidate(
  candidate: Record<string, unknown>,
  root: Record<string, unknown>,
): CardScanCandidate {
  const card = firstRecord([readPath(candidate, ["card"])]) ?? {};
  const recognizedFields = firstRecord([readPath(root, ["recognized_fields"])]) ?? {};
  const canonicalPrintUid = firstString([
    getString(candidate, "canonical_print_uid"),
    getString(card, "canonical_print_uid"),
    getString(root, "canonical_print_uid"),
  ]);
  const setId = firstString([
    getString(card, "set_id"),
    getString(card, "tcgDexSetId"),
    getString(recognizedFields, "set_id"),
  ]) ?? "";
  const localId = firstString([
    getString(card, "collector_number"),
    getString(card, "local_id"),
    getString(recognizedFields, "collector_number"),
  ]) ?? "";
  const name = firstString([
    getString(card, "name"),
    getString(recognizedFields, "name"),
  ]) ?? "";
  const language = firstString([
    getString(card, "language"),
    getString(recognizedFields, "language"),
  ]);
  const evidenceRecord = firstRecord([readPath(candidate, ["evidence"])]) ?? {};

  return {
    card: {
      cardNumber: localId,
      id: getString(card, "id") ?? canonicalPrintUid ?? `${setId}-${localId}`,
      imageUrl: getString(card, "image_url") ?? getString(card, "imageUrl") ?? "",
      language: language ?? "ja",
      name,
      setName:
        getString(card, "set_name") ??
        getString(card, "setName") ??
        getString(recognizedFields, "set_name") ??
        "",
      source: "tcgdex",
      tcgDexSetId: setId,
    },
    confidence: clamp(Number(getNumber(candidate, "score") ?? getNumber(root, "match_confidence") ?? 0), 0.1, 0.99),
    evidence: {
      canonicalPrintUid,
      cardNumber: localId,
      language: language === "en" ? "en" : "ja",
      name,
      setCode: setId,
      setName:
        getString(card, "set_name") ??
        getString(card, "setName") ??
        getString(recognizedFields, "set_name"),
    },
    query: [setId, localId, name].filter(Boolean).join(" "),
    source: "local-image",
    canonicalPrintUid,
    recognitionEvidence: numericRecord(evidenceRecord),
    marketplaces: firstRecord([readPath(candidate, ["marketplaces"])]) as
      | CardRecognitionContract
      | undefined,
  };
}

async function assertPathExists(value: string, message: string): Promise<void> {
  if (!(await pathExists(value))) {
    throw new Error(`${message}: ${value}`);
  }
}

async function pathExists(value: string): Promise<boolean> {
  try {
    await access(value);
    return true;
  } catch {
    return false;
  }
}

function extensionForFile(file: File): string {
  if (file.type === "image/png") {
    return ".png";
  }

  if (file.type === "image/webp") {
    return ".webp";
  }

  return ".jpg";
}

function localMatcherTop(): number {
  return intFromEnv("LOCAL_CARD_MATCHER_TOP", 8, 1, 20);
}

function localMatcherTimeoutMs(): number {
  return intFromEnv("LOCAL_CARD_MATCHER_TIMEOUT_MS", 120_000, 10_000, 300_000);
}

function intFromEnv(
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(process.env[key] ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

async function scanWithGiblTcg(file: File): Promise<ProviderExtraction[]> {
  const key = process.env.GIBLTCG_API_KEY;
  if (!key) {
    return [];
  }

  const url =
    process.env.GIBLTCG_API_URL ??
    `${GIBL_BASE_URL}/predict-card?key=${encodeURIComponent(key)}`;
  const body = new FormData();
  body.append("file", file);

  const response = await fetchWithTimeout(url, {
    method: "POST",
    body,
  });

  if (!response.ok) {
    if (response.status === 402) {
      throw new Error("GiblTCG image matching returned 402. Check scan credits or plan access.");
    }

    throw new Error(`GiblTCG returned ${response.status}`);
  }

  const data = (await response.json()) as unknown;
  const detections = parseGiblResponse(data);
  if (detections.length === 0) {
    throw new Error("GiblTCG returned zero card detections.");
  }

  const resolved = await Promise.all(
    detections.map(async (detection) => {
      if (detection.queries.length > 0 || !detection.evidence.giblIdentity) {
        return detection;
      }

      const identity = await resolveGiblIdentity(detection.evidence.giblIdentity);
      if (!identity) {
        return detection;
      }

      return buildExtraction({
        source: "gibltcg",
        confidence: detection.confidence,
        evidence: {
          ...detection.evidence,
          ...identity,
        },
      });
    }),
  );

  return resolved.filter((detection) => detection.queries.length > 0);
}

async function scanWithGoogleVision(
  file: File,
): Promise<ProviderExtraction | undefined> {
  const key = process.env.GOOGLE_VISION_API_KEY;
  if (!key) {
    return undefined;
  }

  const imageBytes = Buffer.from(await file.arrayBuffer()).toString("base64");
  const response = await fetchWithTimeout(
    `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            image: { content: imageBytes },
            features: [{ type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 }],
            imageContext: { languageHints: ["ja", "en"] },
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Google Vision returned ${response.status}`);
  }

  const data = (await response.json()) as unknown;
  const text = extractGoogleVisionText(data);
  return text ? extractionFromText(text, "google-ocr") : undefined;
}

function extractionFromText(
  text: string,
  source: CardScanSource,
): ProviderExtraction | undefined {
  const scan = extractDealScan(text);
  const psaCert = scan.psaCerts[0];
  if (scan.searchQueries.length === 0 && !scan.yenPrice && !psaCert) {
    return undefined;
  }

  return {
    source,
    confidence: source === "google-ocr" ? 0.62 : 0.5,
    evidence: {
      cardNumber: scan.cardNumbers[0],
      setCode: scan.setCodes[0],
      rawText: text,
      priceYen: scan.yenPrice,
      psaCert,
    },
    queries: scan.searchQueries,
  };
}

function parseGiblResponse(data: unknown): ProviderExtraction[] {
  const roots = recordsFromMaybeArray(readPath(data, ["items"]));
  const items = roots.length > 0 ? roots : recordsFromMaybeArray(data);
  const detections: ProviderExtraction[] = [];

  for (const item of items) {
    const nestedCard = firstRecord([
      readPath(item, ["card"]),
      readPath(item, ["result", "card"]),
      readPath(item, ["data", "card"]),
    ]);
    const root = nestedCard ?? item;
    const best = firstRecord([
      readPath(root, ["identity", "best"]),
      readPath(item, ["identity", "best"]),
      readPath(root, ["card", "identity", "best"]),
    ]);
    const match = firstRecord([
      readPath(best, ["match"]),
      readPath(root, ["match"]),
      readPath(item, ["match"]),
    ]);

    const evidence = evidenceFromRecord(match ?? root);
    const confidence =
      normalizeConfidence(
        firstNumber([
          getNumber(best, "confidence"),
          getNumber(match, "confidence"),
          getNumber(root, "confidence"),
        ]),
      ) ?? 0.85;

    if (hasSearchEvidence(evidence)) {
      detections.push(
        buildExtraction({
          source: "gibltcg",
          confidence,
          evidence,
        }),
      );
    }

    const identityValues = recordsFromMaybeArray(readPath(item, ["identity"]));
    for (const identity of identityValues.slice(0, 3)) {
      const giblIdentity = firstString([
        getString(identity, "card_identity"),
        getString(identity, "cardIdentity"),
        getString(identity, "id"),
        getString(identity, "label"),
      ]);
      if (!giblIdentity) {
        continue;
      }

      detections.push({
        source: "gibltcg",
        confidence:
          normalizeConfidence(
            firstNumber([
              getNumber(identity, "card_identity_confidence"),
              getNumber(identity, "confidence"),
            ]),
          ) ?? confidence,
        evidence: { giblIdentity },
        queries: [],
      });
    }
  }

  return detections;
}

function buildExtraction({
  confidence,
  evidence,
  source,
}: {
  confidence: number;
  evidence: CardScanEvidence;
  source: CardScanSource;
}): ProviderExtraction {
  const cardNumbers = evidence.cardNumber ? [evidence.cardNumber] : [];
  const setCodes = [
    ...(evidence.setCode ? [evidence.setCode] : []),
    ...(evidence.setName ? extractSetCodes(evidence.setName) : []),
  ];
  const nameCandidates = evidence.name ? [evidence.name] : [];

  const queries = [
    ...buildScanSearchQueries({ cardNumbers, nameCandidates, setCodes }),
    ...directEvidenceQueries(evidence),
  ];

  return {
    source,
    confidence,
    evidence,
    queries: uniqueStrings(queries).slice(0, MAX_SEARCH_QUERIES),
  };
}

function directEvidenceQueries(evidence: CardScanEvidence): string[] {
  const queries: string[] = [];
  const name = evidence.name?.trim();
  const setName = evidence.setName?.trim();
  const cardNumber = evidence.cardNumber?.trim();

  if (name && setName && cardNumber) {
    queries.push(`${name} ${setName} ${cardNumber}`);
  }

  if (name && setName) {
    queries.push(`${name} ${setName}`);
  }

  return queries;
}

async function resolveCandidates(
  extractions: ProviderExtraction[],
): Promise<CardScanCandidate[]> {
  const scored = new Map<string, ScoredCandidate>();

  for (const extraction of extractions) {
    for (const query of extraction.queries.slice(0, MAX_SEARCH_QUERIES)) {
      const parsed = parseCardSearchQuery(query);
      let results: CardSearchResult[] = [];
      try {
        results = await searchTcgDexCards(query);
      } catch {
        continue;
      }

      for (const [index, card] of results.slice(0, 5).entries()) {
        const searchScore = scoreSearchResult(card, parsed);
        const score = extraction.confidence * 100 + searchScore - index * 4;
        const key = card.id;
        const candidateConfidence = candidateConfidenceFromScore(
          extraction.confidence,
          searchScore,
          extraction.source,
        );
        const current = scored.get(key);
        if (current && current.score >= score) {
          continue;
        }

        scored.set(key, {
          query,
          confidence: candidateConfidence,
          source: extraction.source,
          card,
          evidence: extraction.evidence,
          score,
        });
      }
    }
  }

  return Array.from(scored.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(stripScore);
}

function stripScore(candidate: ScoredCandidate): CardScanCandidate {
  return {
    card: candidate.card,
    confidence: candidate.confidence,
    evidence: candidate.evidence,
    query: candidate.query,
    source: candidate.source,
  };
}

function candidateConfidenceFromScore(
  providerConfidence: number,
  searchScore: number,
  source: CardScanSource,
): number {
  if (source === "gibltcg" && searchScore >= 180) {
    return clamp(providerConfidence, 0.8, 0.99);
  }

  const searchConfidence = clamp(searchScore / 420, 0.1, 0.85);
  return clamp(providerConfidence * 0.55 + searchConfidence * 0.45, 0.1, 0.99);
}

async function resolveGiblIdentity(
  identity: string,
): Promise<CardScanEvidence | undefined> {
  const key = process.env.GIBLTCG_API_KEY;
  if (!key) {
    return undefined;
  }

  for (const type of GIBL_CARD_LIST_TYPES) {
    const url = `${GIBL_BASE_URL}/${type}/card-list?key=${encodeURIComponent(
      key,
    )}&q=${encodeURIComponent(identity)}`;
    try {
      const response = await fetchWithTimeout(url, { method: "GET" });
      if (!response.ok) {
        continue;
      }

      const data = (await response.json()) as unknown;
      const records = recordsFromMaybeArray(readPath(data, ["data"]));
      const exact =
        records.find((record) =>
          [
            getString(record, "id"),
            getString(record, "cardId"),
            getString(record, "card_identity"),
          ].includes(identity),
        ) ?? records[0];

      if (exact) {
        return evidenceFromRecord(exact);
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

function evidenceFromRecord(record: Record<string, unknown> | undefined): CardScanEvidence {
  if (!record) {
    return {};
  }

  const number = firstString([
    getString(record, "number"),
    getString(record, "cardNumber"),
    getString(record, "collectorNumber"),
    getString(record, "localId"),
  ]);
  const printedTotal = firstString([
    getString(record, "printedTotal"),
    getString(record, "total"),
  ]);
  const cardNumber = number && printedTotal ? `${number}/${printedTotal}` : number;

  return {
    name: firstString([
      getString(record, "name"),
      getString(record, "cardName"),
      getString(record, "title"),
    ]),
    setCode: firstString([
      getString(record, "setCode"),
      getString(record, "set_id"),
      getString(record, "setId"),
    ]),
    setName: firstString([
      getString(record, "setName"),
      getString(record, "set"),
      getString(record, "expansion"),
    ]),
    cardNumber,
    language: inferLanguage(record),
  };
}

function extractGoogleVisionText(data: unknown): string | undefined {
  const responses = recordsFromMaybeArray(readPath(data, ["responses"]));
  const first = responses[0];
  if (!first) {
    return undefined;
  }

  const fullText = firstRecord([readPath(first, ["fullTextAnnotation"])]);
  return firstString([
    getString(fullText, "text"),
    getString(recordsFromMaybeArray(readPath(first, ["textAnnotations"]))[0], "description"),
  ]);
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs = 12_000,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function getProviderOrder(): CardScanSource[] {
  const configured = (process.env.SCAN_PROVIDER_ORDER ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(isCardScanSource);

  return configured.length > 0 ? configured : DEFAULT_PROVIDER_ORDER;
}

function providerWarning(provider: CardScanSource, error: unknown): string {
  const message = error instanceof Error ? error.message : "scan failed";
  return `${provider} failed: ${message}`;
}

function normalizeConfidence(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value > 1 ? clamp(value / 100, 0, 1) : clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hasSearchEvidence(evidence: CardScanEvidence): boolean {
  return Boolean(evidence.name || evidence.cardNumber || evidence.setCode || evidence.setName);
}

function isCardScanSource(value: string): value is CardScanSource {
  return (
    value === "gibltcg" ||
    value === "google-ocr" ||
    value === "local-image" ||
    value === "local-ocr"
  );
}

function inferLanguage(record: Record<string, unknown>): "ja" | "en" | undefined {
  const value = firstString([
    getString(record, "language"),
    getString(record, "lang"),
    getString(record, "locale"),
  ])?.toLowerCase();

  if (value?.startsWith("ja") || value?.includes("japan")) {
    return "ja";
  }

  if (value?.startsWith("en")) {
    return "en";
  }

  return undefined;
}

function readPath(value: unknown, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => {
    if (!isRecord(current)) {
      return undefined;
    }

    return current[key];
  }, value);
}

function recordsFromMaybeArray(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }

  return isRecord(value) ? [value] : [];
}

function firstRecord(values: unknown[]): Record<string, unknown> | undefined {
  return values.find(isRecord);
}

function getString(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function getNumber(
  record: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = record?.[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function numericRecord(record: Record<string, unknown>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(record)
      .map(([key, value]) => {
        if (typeof value === "number" && Number.isFinite(value)) {
          return [key, value] as const;
        }

        if (typeof value === "string") {
          const parsed = Number.parseFloat(value);
          if (Number.isFinite(parsed)) {
            return [key, parsed] as const;
          }
        }

        return undefined;
      })
      .filter((entry): entry is readonly [string, number] => Boolean(entry)),
  );
}

function firstString(values: Array<string | undefined>): string | undefined {
  return values.find((value): value is string => Boolean(value));
}

function firstNumber(values: Array<number | undefined>): number | undefined {
  return values.find((value): value is number => value !== undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueSources(values: CardScanSource[]): CardScanSource[] {
  return Array.from(new Set(values));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function mergeScanCandidates(candidates: CardScanCandidate[]): CardScanCandidate[] {
  const merged: CardScanCandidate[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
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
