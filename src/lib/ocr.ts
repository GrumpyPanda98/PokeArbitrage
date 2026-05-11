export async function recognizeImageText(
  file: File,
  languages = "eng+jpn",
): Promise<string> {
  const { recognize } = await import("tesseract.js");
  const result = await recognize(file, languages);
  return result.data.text;
}

export async function recognizePriceText(file: File): Promise<string> {
  const Tesseract = await import("tesseract.js");
  const worker = await Tesseract.createWorker("eng+jpn");

  try {
    await worker.setParameters({
      preserve_interword_spaces: "1",
      tessedit_char_whitelist:
        "0123456789OoIl|SsB,. ¥￥円税込税抜特価価格値段JPYjpyYy",
      tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
      user_defined_dpi: "300",
    });
    const result = await worker.recognize(file);
    return result.data.text;
  } finally {
    await worker.terminate();
  }
}

export type DealScanExtraction = {
  cardNumbers: string[];
  setCodes: string[];
  searchQueries: string[];
  psaCerts: string[];
  yenPrice?: number;
  rawText: string;
};

type PriceCandidate = {
  value: number;
  score: number;
  index: number;
};

type ParsedYenCandidate = {
  value: number;
  scoreBonus: number;
};

const OCR_YEN_DIGIT = "[0-9OoIl|SsB]";
const SEPARATED_YEN_NUMBER = `${OCR_YEN_DIGIT}{1,3}(?:\\s*[,\\.]\\s*${OCR_YEN_DIGIT}{3})+`;
const SPACE_GROUPED_YEN_NUMBER = `${OCR_YEN_DIGIT}{1,3}(?:\\s+${OCR_YEN_DIGIT}{3})+`;
const LABELED_YEN_TOKEN = `(${SEPARATED_YEN_NUMBER}|${SPACE_GROUPED_YEN_NUMBER}|${OCR_YEN_DIGIT}{3,7})`;
const UNLABELED_YEN_TOKEN = `(${SEPARATED_YEN_NUMBER}|${SPACE_GROUPED_YEN_NUMBER}|${OCR_YEN_DIGIT}{4,7})`;

export function extractDealScan(text: string): DealScanExtraction {
  const cardNumbers = extractCardNumbers(text);
  const setCodes = extractSetCodes(text);
  const nameCandidates = extractNameCandidates(text);
  const psaCerts = extractPsaCertNumbers(text);

  return {
    cardNumbers,
    setCodes,
    searchQueries: buildScanSearchQueries({
      cardNumbers,
      setCodes,
      nameCandidates,
    }),
    psaCerts,
    yenPrice: pickBestYenPrice(text),
    rawText: text,
  };
}

export function extractCardNumbers(text: string): string[] {
  const normalized = normalizeOcrText(text);
  const candidates: string[] = [];

  for (const match of normalized.matchAll(
    /\b((?:(?:TG|GG|SWSH|SM|XY|BW|DP|HGSS|SVP|SV)\s*)?0*\d{1,4})\s*\/\s*(\d{1,4})\b/gi,
  )) {
    candidates.push(normalizeCardNumber(match[1]));
  }

  for (const match of normalized.matchAll(
    /(?:card\s*no\.?|no\.?|#|番号|カード番号)\s*[:：#]?\s*((?:(?:TG|GG|SWSH|SM|XY|BW|DP|HGSS|SVP|SV)\s*)?0*\d{1,4})\b/gi,
  )) {
    candidates.push(normalizeCardNumber(match[1]));
  }

  for (const match of normalized.matchAll(
    /\b((?:TG|GG|SWSH|SM|XY|BW|DP|HGSS|SVP|SV)\s*0*\d{1,4})\b/gi,
  )) {
    candidates.push(normalizeCardNumber(match[1]));
  }

  return unique(candidates);
}

export function extractSetCodes(text: string): string[] {
  const normalized = normalizeOcrText(text);
  const candidates: string[] = [];

  for (const match of normalized.matchAll(/\bM?(SV\d{1,2}[A-Z])\b/gi)) {
    candidates.push(normalizeSetCode(match[1]));
  }

  for (const match of normalized.matchAll(
    /\b(EM|EVS|SWSH\d{1,2}|CRE|BRS|ASR|LOR|SIT|FST|CRZ|CEL|HIF|CEC|TEU|FUT20|PRE|PAF|TWM|TEF|OBF|PAL|SCR|SSP)\b/gi,
  )) {
    candidates.push(match[1].toUpperCase());
  }

  return unique(candidates);
}

export function extractPsaCertNumbers(text: string): string[] {
  const normalized = normalizeOcrText(text);
  const candidates: string[] = [];

  for (const match of normalized.matchAll(
    /(?:PSA|CERT|CERTIFICATION|証明|鑑定)\D{0,20}(\d{7,10})\b/gi,
  )) {
    candidates.push(match[1]);
  }

  return unique(candidates);
}

export function extractNameCandidates(text: string): string[] {
  const normalized = normalizeOcrText(text);
  return unique(
    normalized
      .split(/\r?\n/)
      .map(stripLikelyNonNameText)
      .map((line) =>
        line.replace(/[^\p{L}\p{N}\s'.:-]/gu, " ").replace(/\s+/g, " ").trim(),
      )
      .filter(isLikelyCardNameLine)
      .map((line) => line.replace(/\b(?:HP|PSA|GEM|MINT|CERT|NO)\b.*$/i, "").trim())
      .filter((line) => line.length >= 3),
  ).slice(0, 4);
}

function stripLikelyNonNameText(line: string): string {
  return line
    .replace(/(?:税込|税抜|特価|価格|値段).*$/i, " ")
    .replace(/¥\s*[0-9][0-9,.\s]{2,14}.*$/i, " ")
    .replace(/\b\d{1,4}\s*\/\s*\d{1,4}\b/g, " ")
    .replace(/\b(?:TG|GG|SWSH|SM|XY|BW|DP|HGSS|SVP|SV)\s*0*\d{1,4}\b/gi, " ");
}

export function buildScanSearchQueries({
  cardNumbers,
  nameCandidates = [],
  setCodes,
}: {
  cardNumbers: string[];
  nameCandidates?: string[];
  setCodes: string[];
}): string[] {
  const queries: string[] = [];

  for (const setCode of setCodes) {
    for (const cardNumber of cardNumbers) {
      queries.push(`${setCode} ${cardNumber}`);
    }
  }

  for (const name of nameCandidates) {
    for (const setCode of setCodes) {
      for (const cardNumber of cardNumbers) {
        queries.push(`${name} ${setCode} ${cardNumber}`);
      }
    }

    for (const cardNumber of cardNumbers) {
      queries.push(`${name} ${cardNumber}`);
    }
  }

  queries.push(...nameCandidates);
  queries.push(...cardNumbers);

  return unique(queries.map((query) => query.trim()).filter((query) => query.length >= 2));
}

export function extractYenPrices(text: string): number[] {
  return uniqueNumbers(findPriceCandidates(text).map((candidate) => candidate.value));
}

export function pickBestYenPrice(text: string): number | undefined {
  const candidates = findPriceCandidates(text);
  return candidates[0]?.value;
}

function findPriceCandidates(text: string): PriceCandidate[] {
  const normalized = normalizeOcrText(text);
  const candidates: PriceCandidate[] = [];
  const patterns: Array<{ regex: RegExp; score: number }> = [
    {
      regex: new RegExp(
        `(?:税込|税抜|特価|価格|値段|PRICE|JPY)\\s*[:：]?\\s*(?:[¥Y])?\\s*${LABELED_YEN_TOKEN}`,
        "gi",
      ),
      score: 120,
    },
    { regex: new RegExp(`[¥Y]\\s*${LABELED_YEN_TOKEN}`, "gi"), score: 110 },
    {
      regex: new RegExp(`${LABELED_YEN_TOKEN}\\s*(?:円|YEN|JPY)`, "gi"),
      score: 105,
    },
    { regex: new RegExp(`\\b${UNLABELED_YEN_TOKEN}\\b`, "gi"), score: 20 },
  ];

  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern.regex)) {
      for (const parsed of parseYenTokenCandidates(match[1])) {
        candidates.push({
          value: parsed.value,
          score: pattern.score + digitScore(parsed.value) + parsed.scoreBonus,
          index: match.index ?? 0,
        });
      }
    }
  }

  return candidates.sort((a, b) => b.score - a.score || a.index - b.index);
}

function parseYenTokenCandidates(value: string): ParsedYenCandidate[] {
  const hasGrouping = /[,.\s]/.test(value);
  const digits = value
    .replace(/[Oo]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[Ss]/g, "5")
    .replace(/B/g, "8")
    .replace(/\D/g, "");
  if (digits.length < 3) {
    return [];
  }

  const candidates: ParsedYenCandidate[] = [];
  const parsed = parseValidYenDigits(digits);
  if (parsed !== undefined) {
    candidates.push({ value: parsed, scoreBonus: 0 });
  }

  if (!hasGrouping) {
    candidates.push(...splitLikelyRunOnPrice(digits));
  }

  return uniqueParsedYenCandidates(candidates);
}

function splitLikelyRunOnPrice(digits: string): ParsedYenCandidate[] {
  if (digits.length < 5) {
    return [];
  }

  const candidates: ParsedYenCandidate[] = [];
  for (const suffixLength of [2, 3]) {
    if (digits.length <= suffixLength + 2) {
      continue;
    }

    const suffix = Number.parseInt(digits.slice(-suffixLength), 10);
    const prefix = parseValidYenDigits(digits.slice(0, -suffixLength));
    if (prefix === undefined || !isLikelyAttackDamageSuffix(suffix)) {
      continue;
    }

    candidates.push({
      value: prefix,
      scoreBonus: suffixLength === 2 ? 45 : 32,
    });
  }

  return candidates;
}

function parseValidYenDigits(digits: string): number | undefined {
  const parsed = Number.parseInt(digits, 10);
  if (!Number.isFinite(parsed) || parsed < 100 || parsed > 10_000_000) {
    return undefined;
  }

  return parsed;
}

function isLikelyAttackDamageSuffix(value: number): boolean {
  return value >= 10 && value <= 330 && value % 10 === 0;
}

function uniqueParsedYenCandidates(
  candidates: ParsedYenCandidate[],
): ParsedYenCandidate[] {
  const best = new Map<number, ParsedYenCandidate>();
  for (const candidate of candidates) {
    const current = best.get(candidate.value);
    if (!current || candidate.scoreBonus > current.scoreBonus) {
      best.set(candidate.value, candidate);
    }
  }

  return Array.from(best.values());
}

function digitScore(value: number): number {
  if (value >= 1000) {
    return 20;
  }

  return 0;
}

function normalizeOcrText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[￥]/g, "¥")
    .replace(/[／⁄∕]/g, "/")
    .replace(/(?<=\d)[oO](?=\d)/g, "0")
    .replace(/[，]/g, ",");
}

function normalizeCardNumber(value: string): string {
  const compact = value.replace(/\s+/g, "").toUpperCase();
  const match = compact.match(/^([A-Z]*?)0*(\d{1,4})$/);
  return match ? `${match[1]}${Number(match[2])}` : compact;
}

function normalizeSetCode(value: string): string {
  const compact = value.replace(/\s+/g, "").toUpperCase();
  const match = compact.match(/^SV(\d{1,2})([A-Z])$/);
  return match ? `SV${Number(match[1])}${match[2].toLowerCase()}` : compact;
}

function isLikelyCardNameLine(line: string): boolean {
  if (line.length < 3 || line.length > 42) {
    return false;
  }

  if (!/[A-Za-z]/.test(line)) {
    return false;
  }

  if (/[¥円税込特価価格]/.test(line)) {
    return false;
  }

  if (/\b(?:HP|PSA|CERT|GEM|MINT|NO|TRAINER|BASIC|STAGE|WEAKNESS|RESISTANCE|RETREAT)\b/i.test(line)) {
    return false;
  }

  if (/^\d+$/.test(line)) {
    return false;
  }

  return line.split(/\s+/).length <= 6;
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value)) {
      return false;
    }

    seen.add(value);
    return true;
  });
}

function uniqueNumbers(values: number[]): number[] {
  const seen = new Set<number>();
  return values.filter((value) => {
    if (seen.has(value)) {
      return false;
    }

    seen.add(value);
    return true;
  });
}
