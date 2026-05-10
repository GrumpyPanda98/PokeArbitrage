"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Calculator,
  Camera,
  Clock3,
  ExternalLink,
  Home,
  LockKeyhole,
  MoreHorizontal,
  RotateCcw,
  Save,
  ScanLine,
  Search,
  ShieldCheck,
  ShoppingCart,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  calculateDeal,
  cleanNumber,
  CONDITION_LABELS,
  DEFAULT_SETTINGS,
  formatMoney,
  formatPercent,
  formatSignedMoney,
  formatYen,
  normalizeSettings,
  normalizeRawCondition,
  optionalNumber,
  type CardLanguage,
  type DealCalculation,
  type DealRouteResult,
  type DealStatus,
  type Decision,
  type InHandCondition,
  type LanguageBucket,
  type RawCardCondition,
  type ReferencePriceFilters,
  type ReferenceSource,
  type ReferenceValues,
  type Settings as AppSettings,
} from "@/lib/calculations";
import {
  extractDealScan,
  recognizePriceText,
} from "@/lib/ocr";
import {
  scanPriceImage,
  type PriceOcrResponse,
} from "@/lib/price-ocr";
import { buildCardmarketSearchUrl } from "@/lib/cardmarket-url";
import { fetchReferencePrices } from "@/lib/reference-prices";
import {
  scanCardImage,
  type CardScanCandidate,
  type CardScanResponse,
} from "@/lib/scan-card";
import {
  mergeScanCandidates,
  selectAutoScanCandidate,
} from "@/lib/scan-merge";
import { useLocalStorageState } from "@/lib/storage";
import { searchCards, type CardSearchResult } from "@/lib/card-search";
import type {
  DealForm,
  ReferenceState,
  SavedDeal,
  Screen,
  StoreContext,
} from "@/lib/types";

const STORAGE_KEYS = {
  unlocked: "pokearb.unlocked.v1",
  settings: "pokearb.settings.v2",
  history: "pokearb.deals.v2",
  storeContext: "pokearb.store-context.v1",
};

const PASSCODE = process.env.NEXT_PUBLIC_POKEARB_PASSCODE ?? "Japan";
const EMPTY_HISTORY: SavedDeal[] = [];

const EMPTY_REFERENCE_STATE: ReferenceState = {
  sources: [],
  isFetching: false,
};

const DEFAULT_STORE_CONTEXT: StoreContext = {
  store: "",
  city: "Tokyo",
};

function makeEmptyDealForm(
  storeContext: StoreContext = DEFAULT_STORE_CONTEXT,
): DealForm {
  return {
    inHandCondition: "raw",
    cardName: "",
    setName: "",
    cardNumber: "",
    imageUrl: "",
    shopPriceYen: "",
    rawCondition: "NM",
    languageBucket: "asian",
    cardLanguage: "ja",
    rawMarketDkk: "",
    psa7MarketDkk: "",
    psa8MarketDkk: "",
    psa9MarketDkk: "",
    psa95MarketDkk: "",
    psa10MarketDkk: "",
    store: storeContext.store,
    city: storeContext.city || "Tokyo",
    notes: "",
  };
}

const EMPTY_DEAL_FORM: DealForm = makeEmptyDealForm();

const NAV_ITEMS: Array<{ screen: Screen; label: string; icon: LucideIcon }> = [
  { screen: "home", label: "Home", icon: Home },
  { screen: "deal-check", label: "Deal", icon: Calculator },
  { screen: "history", label: "History", icon: Clock3 },
  { screen: "settings", label: "Settings", icon: MoreHorizontal },
];

export default function App() {
  const [mounted, setMounted] = useState(false);
  const [unlocked, setUnlocked] = useLocalStorageState(
    STORAGE_KEYS.unlocked,
    false,
  );
  const [storedSettings, setSettings] = useLocalStorageState(
    STORAGE_KEYS.settings,
    DEFAULT_SETTINGS,
  );
  const settings = useMemo(
    () => normalizeSettings(storedSettings),
    [storedSettings],
  );
  const [history, setHistory] = useLocalStorageState<SavedDeal[]>(
    STORAGE_KEYS.history,
    EMPTY_HISTORY,
  );
  const [storeContext, setStoreContext] = useLocalStorageState<StoreContext>(
    STORAGE_KEYS.storeContext,
    DEFAULT_STORE_CONTEXT,
  );
  const [screen, setScreen] = useState<Screen>("home");
  const [passcode, setPasscode] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmLockOpen, setConfirmLockOpen] = useState(false);
  const [form, setForm] = useState<DealForm>(EMPTY_DEAL_FORM);
  const [selectedCard, setSelectedCard] = useState<CardSearchResult | undefined>();
  const [reference, setReference] =
    useState<ReferenceState>(EMPTY_REFERENCE_STATE);

  const referenceValues = useMemo(
    () => buildReferenceValues(form, reference, selectedCard),
    [form, reference, selectedCard],
  );
  const calculation = useMemo(
    () =>
      calculateDeal(
        form.inHandCondition,
        cleanNumber(form.shopPriceYen),
        referenceValues,
        settings,
      ),
    [form.inHandCondition, form.shopPriceYen, referenceValues, settings],
  );

  const boughtDeals = history.filter((deal) => normalizeStatus(deal.status) === "bought");
  const boughtYen = boughtDeals.reduce((sum, deal) => sum + deal.shopPriceYen, 0);
  const boughtDkk = boughtDeals.reduce((sum, deal) => sum + deal.costDkk, 0);

  useEffect(() => {
    const id = window.setTimeout(() => setMounted(true), 0);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!mounted) {
      return;
    }

    const id = window.setTimeout(() => {
      setForm((current) => ({
        ...current,
        store: current.store || storeContext.store,
        city: current.city || storeContext.city || "Tokyo",
      }));
    }, 0);
    return () => window.clearTimeout(id);
  }, [mounted, storeContext.city, storeContext.store]);

  useEffect(() => {
    if (!mounted || !selectedCard) {
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(() => {
      const filters: ReferencePriceFilters = {
        cardLanguage: form.cardLanguage,
        languageBucket: form.languageBucket,
        minCondition: "NM",
      };

      setReference({ sources: [], isFetching: true });
      setNotice("");

      fetchReferencePrices(selectedCard, filters)
        .then((values) => {
          if (cancelled) {
            return;
          }

          if (
            !values.rawDkk &&
            !values.psa7Dkk &&
            !values.psa8Dkk &&
            !values.psa9Dkk &&
            !values.psa95Dkk &&
            !values.psa10Dkk
          ) {
            setReference({
              ...values,
              isFetching: false,
              error:
                "Could not fetch reference prices. You can still enter values manually.",
            });
            return;
          }

          setReference({ ...values, isFetching: false });
        })
        .catch(() => {
          if (cancelled) {
            return;
          }

          setReference({
            sources: [],
            isFetching: false,
            error:
              "Could not fetch reference prices. You can still enter values manually.",
          });
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [
    form.cardLanguage,
    form.languageBucket,
    mounted,
    selectedCard,
  ]);

  if (!mounted) {
    return <main aria-hidden="true" className="app-shell min-h-screen" />;
  }

  function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (passcode === PASSCODE) {
      setUnlocked(true);
      setPasscode("");
      setNotice("");
      return;
    }

    setNotice("Wrong passcode.");
  }

  function lock() {
    setUnlocked(false);
    setPasscode("");
    setNotice("");
    setConfirmLockOpen(false);
  }

  function patchForm(field: keyof DealForm, value: string) {
    if (field === "languageBucket") {
      const bucket = value as LanguageBucket;
      setForm((current) => ({
        ...current,
        languageBucket: bucket,
        cardLanguage: defaultLanguageForBucket(bucket),
      }));
      return;
    }

    if (field === "cardLanguage") {
      const language = value as CardLanguage;
      setForm((current) => ({
        ...current,
        cardLanguage: language,
        languageBucket:
          languageBucketForCardLanguage(language) ?? current.languageBucket,
      }));
      return;
    }

    if (field === "rawCondition") {
      setForm((current) => ({
        ...current,
        rawCondition: normalizeRawCondition(value),
      }));
      return;
    }

    setForm((current) => ({ ...current, [field]: value }));

    if (field === "store" || field === "city") {
      setStoreContext((current) => ({
        store: field === "store" ? value : current.store,
        city: field === "city" ? value : current.city,
      }));
    }
  }

  function selectCard(card: CardSearchResult) {
    setSelectedCard(card);
    setForm((current) => ({
      ...current,
      cardName: card.name,
      setName: card.setName,
      cardNumber: card.cardNumber,
      imageUrl: card.imageUrl,
      rawCondition: "NM",
      cardLanguage: supportedCardLanguage(card.language) ?? current.cardLanguage,
      languageBucket:
        languageBucketForCardLanguage(card.language) ?? current.languageBucket,
    }));
  }

  function saveDeal(status: DealStatus) {
    const shopPriceYen = cleanNumber(form.shopPriceYen);
    if (shopPriceYen <= 0) {
      setNotice("Enter the shop price before saving.");
      return;
    }

    const deal = createSavedDeal(
      form,
      calculation,
      referenceValues,
      status,
    );
    setHistory((current) => [deal, ...current]);
    setNotice(`Saved as ${status}.`);
  }

  function updateDealStatus(id: string, status: DealStatus) {
    setHistory((current) =>
      current.map((deal) => (deal.id === id ? { ...deal, status } : deal)),
    );
  }

  function deleteDeal(id: string) {
    setHistory((current) => current.filter((deal) => deal.id !== id));
  }

  function clearDeal() {
    setForm(makeEmptyDealForm(storeContext));
    setSelectedCard(undefined);
    setReference(EMPTY_REFERENCE_STATE);
    setNotice("");
  }

  function updateSetting(field: keyof AppSettings, value: string) {
    const parsed = cleanNumber(value);
    if (!Number.isFinite(parsed)) {
      return;
    }

    setSettings((current) => ({ ...current, [field]: parsed }));
  }

  if (!unlocked) {
    return (
      <PrivateGate
        notice={notice}
        passcode={passcode}
        setPasscode={setPasscode}
        unlock={unlock}
      />
    );
  }

  return (
    <main className="app-shell">
      <div className="mx-auto min-h-screen max-w-[428px] px-4 pb-[calc(9.75rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))]">
        <AppHeader
          onRequestLock={() => setConfirmLockOpen(true)}
          setScreen={setScreen}
        />

        {notice ? (
          <div className="mb-3 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-sm font-semibold text-amber">
            {notice}
          </div>
        ) : null}

        {screen === "home" ? (
          <HomeScreen setScreen={setScreen} settings={settings} />
        ) : null}

        {screen === "deal-check" ? (
          <DealCheckScreen
            calculation={calculation}
            form={form}
            onChange={patchForm}
            onClear={clearDeal}
            onSave={saveDeal}
            onSelectCard={selectCard}
            reference={reference}
            referenceValues={referenceValues}
            settings={settings}
          />
        ) : null}

        {screen === "psa" ? (
          <PsaSlabScreen onOpenDealCheck={() => setScreen("deal-check")} />
        ) : null}

        {screen === "history" ? (
          <HistoryScreen
            deals={history}
            onDelete={deleteDeal}
            onStatus={updateDealStatus}
            totalBoughtDkk={boughtDkk}
            totalBoughtYen={boughtYen}
          />
        ) : null}

        {screen === "settings" ? (
          <SettingsScreen
            onChange={updateSetting}
            onReset={() => setSettings(DEFAULT_SETTINGS)}
            settings={settings}
          />
        ) : null}
      </div>

      {screen === "deal-check" && cleanNumber(form.shopPriceYen) > 0 ? (
        <StickyDecisionBar calculation={calculation} form={form} />
      ) : null}
      <BottomNav screen={screen} setScreen={setScreen} />
      {confirmLockOpen ? (
        <ConfirmSheet
          body="You will need to enter the passcode again."
          confirmLabel="Lock"
          onCancel={() => setConfirmLockOpen(false)}
          onConfirm={lock}
          title="Lock app?"
        />
      ) : null}
    </main>
  );
}

function PrivateGate({
  notice,
  passcode,
  setPasscode,
  unlock,
}: {
  notice: string;
  passcode: string;
  setPasscode: (value: string) => void;
  unlock: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <main className="app-shell grid min-h-screen place-items-center px-4 py-8">
      <section className="card w-full max-w-[428px] p-4">
        <h1 className="mb-4 text-lg font-semibold">PokéArb Japan</h1>

        <form className="grid gap-3" onSubmit={unlock}>
          <Field
            autoFocus
            label="Passcode"
            onChange={setPasscode}
            type="password"
            value={passcode}
          />
          <button className="button-primary h-11" type="submit">
            Unlock
          </button>
          {notice ? (
            <p className="text-sm font-semibold text-red">{notice}</p>
          ) : null}
        </form>
      </section>
    </main>
  );
}

function AppHeader({
  onRequestLock,
  setScreen,
}: {
  onRequestLock: () => void;
  setScreen: (screen: Screen) => void;
}) {
  return (
    <header className="mb-3 flex items-center justify-between">
      <button
        className="text-left"
        onClick={() => setScreen("home")}
        type="button"
      >
        <p className="text-base font-semibold leading-6">
          PokéArb Japan
        </p>
      </button>
      <button
        aria-label="Lock app"
        className="icon-button"
        onClick={onRequestLock}
        type="button"
      >
        <LockKeyhole size={18} />
      </button>
    </header>
  );
}

function HomeScreen({
  setScreen,
  settings,
}: {
  setScreen: (screen: Screen) => void;
  settings: AppSettings;
}) {
  const actions: Array<{
    screen: Screen;
    title?: string;
    subtitle?: string;
    icon: LucideIcon;
  }> = [
    {
      screen: "deal-check",
      icon: Calculator,
    },
    {
      screen: "psa",
      title: "PSA Slab",
      subtitle: "Verify cert",
      icon: ShieldCheck,
    },
    {
      screen: "history",
      title: "History",
      icon: Clock3,
    },
  ];

  return (
    <section className="space-y-3">
      <section className="card px-3 py-2">
        <p className="text-xs text-muted">Approx. conversion</p>
        <p className="text-sm font-semibold">
          ¥1,000 ≈ {formatMoney(1000 / settings.yenDivisor)}
        </p>
      </section>

      <section className="grid grid-cols-2 gap-2">
        {actions.map((action) => (
          <HomeAction key={action.screen} {...action} setScreen={setScreen} />
        ))}
      </section>
    </section>
  );
}

function HomeAction({
  icon: Icon,
  screen,
  setScreen,
  subtitle,
  title,
}: {
  icon: LucideIcon;
  screen: Screen;
  setScreen: (screen: Screen) => void;
  subtitle?: string;
  title?: string;
}) {
  const label = title ?? NAV_ITEMS.find((item) => item.screen === screen)?.label ?? screen;

  return (
    <button
      aria-label={label}
      className="card flex min-h-20 flex-col items-start justify-between p-3 text-left"
      onClick={() => setScreen(screen)}
      type="button"
    >
      <Icon className="text-muted" size={20} />
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        {subtitle ? <span className="block text-xs text-muted">{subtitle}</span> : null}
      </span>
    </button>
  );
}

function DealCheckScreen({
  calculation,
  form,
  onChange,
  onClear,
  onSave,
  onSelectCard,
  reference,
  referenceValues,
  settings,
}: {
  calculation: DealCalculation;
  form: DealForm;
  onChange: (field: keyof DealForm, value: string) => void;
  onClear: () => void;
  onSave: (status: DealStatus) => void;
  onSelectCard: (card: CardSearchResult) => void;
  reference: ReferenceState;
  referenceValues: ReferenceValues;
  settings: AppSettings;
}) {
  return (
    <section className="space-y-3">
      <InHandConditionSelector
        onChange={(value) => onChange("inHandCondition", value)}
        value={form.inHandCondition}
      />

      <DealPhotoScanner
        onDetectedPrice={(value) => onChange("shopPriceYen", value)}
        onSelectCard={onSelectCard}
      />

      <section className="card p-3">
        <CardSearchCombobox
          languageBucket={form.languageBucket}
          onSelectCard={onSelectCard}
          preferredLanguage={form.cardLanguage}
        />
        {form.cardName ? <SelectedCardSummary form={form} /> : null}
      </section>

      <ShopPriceInput
        costDkk={calculation.costDkk}
        onChange={(value) => onChange("shopPriceYen", value)}
        value={form.shopPriceYen}
      />

      <MainDecisionCard
        calculation={calculation}
        condition={form.inHandCondition}
      />

      <RouteResultsPanel calculation={calculation} />

      <ReferencePricesPanel
        condition={form.inHandCondition}
        reference={reference}
        rawCondition={form.rawCondition}
        values={referenceValues}
      />

      <EditableValuesPanel form={form} onChange={onChange} settings={settings} />

      <section className="grid grid-cols-3 gap-2">
        <ActionButton icon={Save} onClick={() => onSave("seen")} tone="neutral">
          Seen
        </ActionButton>
        <ActionButton icon={X} onClick={() => onSave("skipped")} tone="danger">
          Skip
        </ActionButton>
        <ActionButton
          icon={ShoppingCart}
          onClick={() => onSave("bought")}
          tone="primary"
        >
          Bought
        </ActionButton>
      </section>

      <button className="button-secondary h-10 w-full" onClick={onClear} type="button">
        <RotateCcw size={16} />
        Clear
      </button>
    </section>
  );
}

function InHandConditionSelector({
  onChange,
  value,
}: {
  onChange: (value: InHandCondition) => void;
  value: InHandCondition;
}) {
  const options: InHandCondition[] = ["raw", "psa9", "psa10"];

  return (
    <section className="card p-3">
      <p className="mb-2 text-xs font-medium text-muted">In hand</p>
      <div className="grid grid-cols-3 gap-2">
        {options.map((option) => (
          <button
            className={`h-10 rounded-lg text-sm font-semibold ${
              value === option
                ? "bg-text text-background"
                : "border border-border bg-strong text-muted"
            }`}
            key={option}
            onClick={() => onChange(option)}
            type="button"
          >
            {CONDITION_LABELS[option]}
          </button>
        ))}
      </div>
    </section>
  );
}

const LANGUAGE_OPTIONS: Record<LanguageBucket, CardLanguage[]> = {
  asian: ["ja", "ko", "zh-tw", "zh-cn"],
  western: ["en", "fr", "de", "es", "it", "pt"],
};

function DealPhotoScanner({
  onDetectedPrice,
  onSelectCard,
}: {
  onDetectedPrice: (value: string) => void;
  onSelectCard: (card: CardSearchResult) => void;
}) {
  const [cardError, setCardError] = useState("");
  const [cardResults, setCardResults] = useState<CardSearchResult[]>([]);
  const [detectedCardLabel, setDetectedCardLabel] = useState("");
  const [detectedPrice, setDetectedPrice] = useState<number | undefined>();
  const [message, setMessage] = useState("");
  const [scanning, setScanning] = useState(false);

  async function scanDealPhoto(file: File | undefined) {
    if (!file) {
      return;
    }

    setCardError("");
    setCardResults([]);
    setDetectedCardLabel("");
    setDetectedPrice(undefined);
    setMessage("Scanning...");
    setScanning(true);

    try {
      const [cloudResult, localTextResult] = await Promise.allSettled([
        scanCardImage(file),
        scanPriceWithFallback(file),
      ]);
      const cloud =
        cloudResult.status === "fulfilled" ? cloudResult.value : undefined;
      const priceScan =
        localTextResult.status === "fulfilled"
          ? localTextResult.value
          : undefined;
      const candidates = mergeScanCandidates(cloud?.candidates ?? [], []);
      const cards = cardsFromScanCandidates(candidates);
      const best = selectAutoScanCandidate(candidates) ?? candidates[0];
      const detectedYen = priceScan?.yenPrice;
      const autoSelectCard =
        best?.card && best.source !== "local-ocr" && best.confidence >= 0.8
          ? best.card
          : undefined;

      setDetectedCardLabel(
        best?.card
          ? `${best.card.name} (${confidenceLabel(best.confidence)})`
          : best?.query ?? "",
      );
      setDetectedPrice(detectedYen);
      setCardResults(cards);

      if (detectedYen) {
        onDetectedPrice(String(detectedYen));
      }

      if (autoSelectCard) {
        onSelectCard(autoSelectCard);
      }

      if (cards.length === 0) {
        setCardError("No card matches.");
        setMessage(
          [
            cloudWarning(cloudResult, cloud),
            detectedYen ? `Detected ${formatYen(detectedYen)}.` : "",
            priceWarning(localTextResult, priceScan),
            "Search manually.",
          ]
            .filter(Boolean)
            .join(" "),
        );
        return;
      }

      setMessage(
        [
          autoSelectCard
            ? `Selected ${autoSelectCard.name}.`
            : "Pick a match.",
          detectedYen
            ? `Price ${formatYen(detectedYen)}.`
            : priceWarning(localTextResult, priceScan),
          cloudWarning(cloudResult, cloud),
        ]
          .filter(Boolean)
          .join(" "),
      );
    } catch {
      setMessage("Scan failed. Search manually.");
    } finally {
      setScanning(false);
    }
  }

  function applyDetectedPrice(action: "confirm" | "edit") {
    if (!detectedPrice) {
      return;
    }

    onDetectedPrice(String(detectedPrice));
    setDetectedPrice(undefined);
    setMessage(
      action === "edit"
        ? "Price added. Edit the shop price field if needed."
        : "Price confirmed.",
    );
  }

  function selectScannedCard(card: CardSearchResult) {
    onSelectCard(card);
    setCardResults([]);
    setCardError("");
    setDetectedCardLabel("");
    setMessage(detectedPrice ? "Card selected. Confirm price." : "Card selected.");
  }

  return (
    <section className="card p-3">
      <label className="button-primary h-11 w-full">
        <Camera size={17} />
        {scanning ? "Scanning" : "Scan card + price"}
        <input
          accept="image/*"
          capture="environment"
          className="sr-only"
          disabled={scanning}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = "";
            scanDealPhoto(file);
          }}
          type="file"
        />
      </label>

      {message ? (
        <p className="mt-3 rounded-lg border border-border bg-strong px-3 py-2 text-xs font-medium text-muted">
          {message}
        </p>
      ) : null}

      {detectedPrice ? (
        <div className="mt-3 rounded-lg border border-text/25 bg-strong p-3">
          <p className="text-xs font-semibold text-muted">Detected shop price</p>
          <p className="mt-1 text-xl font-semibold">{formatYen(detectedPrice)}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              className="button-secondary h-10"
              onClick={() => applyDetectedPrice("edit")}
              type="button"
            >
              Edit
            </button>
            <button
              className="button-primary h-10"
              onClick={() => applyDetectedPrice("confirm")}
              type="button"
            >
              Confirm
            </button>
          </div>
        </div>
      ) : null}

      {detectedCardLabel || cardError || cardResults.length > 0 ? (
        <div className="mt-3 rounded-lg border border-border bg-background">
          <div className="border-b border-border px-3 py-2">
            <p className="text-xs font-medium text-muted">
              {detectedCardLabel
                ? `Detected card: ${detectedCardLabel}`
                : "Card matches"}
            </p>
          </div>
          {cardError ? (
            <p className="px-3 py-3 text-sm text-amber">{cardError}</p>
          ) : null}
          {cardResults.slice(0, 6).map((card) => (
            <button
              className="flex w-full items-center gap-3 border-b border-border/80 px-3 py-2 text-left last:border-0"
              key={card.id}
              onClick={() => selectScannedCard(card)}
              type="button"
            >
              <CardThumb imageUrl={card.imageUrl} name={card.name} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{card.name}</span>
                <span className="block truncate text-xs text-muted">
                  {[card.setName, card.cardNumber].filter(Boolean).join(" - ")}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function CardSearchCombobox({
  languageBucket,
  onSelectCard,
  preferredLanguage,
}: {
  languageBucket: LanguageBucket;
  onSelectCard: (card: CardSearchResult) => void;
  preferredLanguage: CardLanguage;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CardSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const searchSequence = useRef(0);

  const runSearch = useCallback(async (value: string, emptyMessage: string) => {
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      if (emptyMessage) {
        setError(emptyMessage);
      }
      setResults([]);
      setOpen(Boolean(emptyMessage));
      return;
    }

    const sequence = searchSequence.current + 1;
    searchSequence.current = sequence;
    setLoading(true);
    setError("");
    setOpen(true);
    try {
      const cards = await searchCards(trimmed, {
        languageBucket,
        preferredLanguage,
      });
      if (sequence !== searchSequence.current) {
        return;
      }

      setResults(cards);
      if (cards.length === 0) {
        setError("No matches. Tap Edit values for manual entry.");
      }
    } catch {
      if (sequence !== searchSequence.current) {
        return;
      }

      setResults([]);
      setError("Card search failed. Manual entry still works.");
    } finally {
      if (sequence === searchSequence.current) {
        setLoading(false);
      }
    }
  }, [languageBucket, preferredLanguage]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void runSearch(query, "");
    }, 350);

    return () => window.clearTimeout(timeout);
  }, [query, runSearch]);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runSearch(query, "Enter at least 2 characters.");
  }

  function select(card: CardSearchResult) {
    onSelectCard(card);
    searchSequence.current += 1;
    setQuery("");
    setOpen(false);
    setResults([]);
    setError("");
  }

  return (
    <div className="relative">
      <form className="flex gap-2" onSubmit={search}>
        <label className="min-w-0 flex-1">
          <span className="sr-only">Search card</span>
          <input
            className="input-shell h-11 w-full rounded-lg px-3 text-base outline-none focus:border-text"
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => {
              if (results.length > 0 || error) setOpen(true);
            }}
            placeholder="Search Pikachu, 205/172, 1/5..."
            value={query}
          />
        </label>
        <button className="button-primary h-11 w-11 px-0" disabled={loading} type="submit">
          <Search size={18} />
        </button>
      </form>

      {open ? (
        <div className="absolute inset-x-0 top-12 z-40 max-h-80 overflow-auto rounded-lg border border-border bg-elevated">
          {loading ? (
            <p className="px-3 py-3 text-sm text-muted">Searching...</p>
          ) : null}
          {!loading && error ? (
            <p className="px-3 py-3 text-sm text-amber">{error}</p>
          ) : null}
          {!loading
            ? results.map((card) => (
                <button
                  className="flex w-full items-center gap-3 border-b border-border/80 px-3 py-2 text-left last:border-0"
                  key={card.id}
                  onClick={() => select(card)}
                  type="button"
                >
                  <CardThumb imageUrl={card.imageUrl} name={card.name} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{card.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {[card.setName, card.cardNumber].filter(Boolean).join(" - ")}
                    </span>
                  </span>
                </button>
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}

function SelectedCardSummary({ form }: { form: DealForm }) {
  return (
    <div className="mt-3 flex items-center gap-3 rounded-lg border border-border bg-surface p-2">
      <CardThumb imageUrl={form.imageUrl} name={form.cardName} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{form.cardName}</p>
        <p className="truncate text-xs text-muted">
          {[form.setName, form.cardNumber].filter(Boolean).join(" - ")}
        </p>
      </div>
    </div>
  );
}

function ShopPriceInput({
  costDkk,
  onChange,
  value,
}: {
  costDkk: number;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <section className="card p-3">
      <label>
        <span className="text-xs font-medium text-muted">Shop price</span>
        <span className="mt-2 flex h-12 items-center rounded-lg border border-border bg-background px-3">
          <span className="mr-2 text-lg font-semibold text-muted">¥</span>
          <input
            className="w-full bg-transparent text-xl font-semibold outline-none placeholder:text-secondary"
            inputMode="numeric"
            onChange={(event) => onChange(event.target.value)}
            placeholder="10,000"
            value={value}
          />
        </span>
      </label>
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-xs text-muted">
          Cost: <span className="font-semibold text-text">{formatMoney(costDkk)}</span>
        </p>
      </div>
    </section>
  );
}

function MainDecisionCard({
  calculation,
  condition,
}: {
  calculation: DealCalculation;
  condition: InHandCondition;
}) {
  const isReady = calculation.displayState === "ready";
  const headline =
    calculation.displayState === "idle"
      ? "Enter shop price"
      : calculation.displayState === "missing"
        ? "Add reference value"
        : calculation.route?.label ?? CONDITION_LABELS[condition];

  return (
    <section className="card p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-muted">Result</p>
          <p
            className={`mt-1 text-xl font-semibold ${
              isReady ? decisionText(calculation.decision) : "text-text"
            }`}
          >
            {headline}
          </p>
        </div>
        {isReady ? <DecisionBadge decision={calculation.decision} /> : null}
      </div>

      {isReady ? (
        <p className="mt-3 text-xl font-semibold">
          {formatSignedMoney(calculation.profitDkk)} /{" "}
          {formatPercent(calculation.marginPercent)}
        </p>
      ) : null}

      <dl className="mt-3 grid text-sm">
        <Fact label="You pay" value={formatMoney(calculation.costDkk)} />
        <Fact
          label="Reference value"
          value={formatMoney(calculation.referenceValueUsedDkk)}
        />
        <Fact
          label="Net after 5%"
          value={formatMoney(calculation.netReferenceValueDkk)}
        />
      </dl>

      {calculation.warning === "PSA_10_TRAP" ? (
        <WarningBox>
          PSA 10 TRAP - this only works if the raw card grades a 10.
        </WarningBox>
      ) : null}

      {calculation.warning === "VALUES_MISSING" && calculation.displayState === "missing" ? (
        <WarningBox>
          Some reference prices are missing. Tap Edit values to enter manually.
        </WarningBox>
      ) : null}

      {calculation.warning === "MANUAL_VALUES" ? (
        <p className="mt-3 text-xs font-medium text-muted">
          Manual values are active.
        </p>
      ) : null}

      {calculation.warning === "HIGH_END_RISK" ? (
        <WarningBox>
          High-end risk. Margin must survive VAT, declaration, and liquidity.
        </WarningBox>
      ) : null}
    </section>
  );
}

function RouteResultsPanel({
  calculation,
}: {
  calculation: DealCalculation;
}) {
  if (calculation.costDkk <= 0 || calculation.routes.length === 0) {
    return null;
  }

  return (
    <section className="card p-3">
      <h3 className="text-sm font-semibold">Routes</h3>
      <div className="mt-2 grid gap-1.5">
        {calculation.routes.map((route) => (
          <RouteResultRow key={route.id} route={route} />
        ))}
      </div>
    </section>
  );
}

function RouteResultRow({ route }: { route: DealRouteResult }) {
  const ready = route.displayState === "ready";

  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{route.label}</p>
          <p className="text-xs text-muted">
            Cost {formatMoney(route.costDkk)} / Net {formatMoney(route.netDkk)}
          </p>
        </div>
        {ready ? (
          <DecisionBadge decision={route.decision} />
        ) : (
          <span className="rounded-md border border-border bg-strong px-2 py-0.5 text-[11px] font-semibold text-muted">
            Need value
          </span>
        )}
      </div>
      <p className="mt-1.5 text-sm font-semibold">
        {formatSignedMoney(route.profitDkk)} / {formatPercent(route.marginPercent)}
      </p>
    </div>
  );
}

function ReferencePricesPanel({
  condition,
  rawCondition,
  reference,
  values,
}: {
  condition: InHandCondition;
  rawCondition: RawCardCondition;
  reference: ReferenceState;
  values: ReferenceValues;
}) {
  const normalizedRawCondition = normalizeRawCondition(rawCondition);
  const gradeRows = gradeReferenceRows(condition, normalizedRawCondition, values);

  return (
    <section className="card p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Reference prices</h3>
        {reference.isFetching ? (
          <span className="text-xs font-medium text-muted">Fetching...</span>
        ) : null}
      </div>

      <div className="grid gap-2">
        <ReferenceRow
          label="Raw"
          primary={condition === "raw"}
          value={values.rawDkk}
        />
        {gradeRows.map((row) => (
          <ReferenceRow
            key={row.label}
            label={row.label}
            primary={row.primary}
            value={row.value}
          />
        ))}
      </div>

      {reference.error ? (
        <p className="mt-3 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-xs font-semibold text-amber">
          {reference.error}
        </p>
      ) : null}

      <div className="mt-3">
        <SourceChips sourceUrls={values.sourceUrls} sources={values.sources} />
      </div>
    </section>
  );
}

function ReferenceRow({
  label,
  primary,
  value,
}: {
  label: string;
  primary: boolean;
  value?: number;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
        primary ? "border-text/40 bg-strong" : "border-border bg-surface"
      }`}
    >
      <div>
        <p className="text-sm font-semibold">{label}</p>
      </div>
      <p className="shrink-0 text-sm font-semibold">{formatMoney(value)}</p>
    </div>
  );
}

type GradeReferenceRow = {
  label: string;
  primary: boolean;
  value?: number;
};

function gradeReferenceRows(
  condition: InHandCondition,
  rawCondition: RawCardCondition,
  values: ReferenceValues,
): GradeReferenceRow[] {
  if (condition === "psa9") {
    return [
      gradeRow("PSA 9", true, values.psa9Dkk),
      gradeRow("PSA 10", false, values.psa10Dkk),
    ];
  }

  if (condition === "psa10") {
    return [
      gradeRow("PSA 10", true, values.psa10Dkk),
      gradeRow("PSA 9", false, values.psa9Dkk),
    ];
  }

  if (rawCondition === "MT") {
    return [
      gradeRow("PSA 9", false, values.psa9Dkk),
      gradeRow("PSA 10", false, values.psa10Dkk),
    ];
  }

  if (rawCondition === "NM") {
    return [
      gradeRow("PSA 8", false, values.psa8Dkk),
      gradeRow("PSA 9", false, values.psa9Dkk),
      gradeRow("PSA 10", false, values.psa10Dkk),
    ];
  }

  if (rawCondition === "EX") {
    return [
      gradeRow("PSA 8", false, values.psa8Dkk),
      gradeRow("PSA 9", false, values.psa9Dkk),
    ];
  }

  if (rawCondition === "GD") {
    return [
      gradeRow("PSA 7", false, values.psa7Dkk),
      gradeRow("PSA 8", false, values.psa8Dkk),
    ];
  }

  if (rawCondition === "LP") {
    return [
      gradeRow("PSA 7", false, values.psa7Dkk),
    ];
  }

  return [];
}

function gradeRow(
  label: string,
  primary: boolean,
  value: number | undefined,
): GradeReferenceRow {
  return {
    label,
    primary,
    value,
  };
}

function EditableValuesPanel({
  form,
  onChange,
  settings,
}: {
  form: DealForm;
  onChange: (field: keyof DealForm, value: string) => void;
  settings: AppSettings;
}) {
  const [open, setOpen] = useState(false);

  return (
    <section className="card p-3">
      <button
        className="flex h-9 w-full items-center justify-between text-sm font-semibold"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        Edit values
        <span className="text-muted">{open ? "Hide" : "Open"}</span>
      </button>

      {open ? (
        <div className="mt-3 grid gap-3">
          <div className="grid gap-2">
            <Field
              inputMode="decimal"
              label="Raw DKK"
              onChange={(value) => onChange("rawMarketDkk", value)}
              value={form.rawMarketDkk}
            />
            <Field
              inputMode="decimal"
              label="PSA 7 DKK"
              onChange={(value) => onChange("psa7MarketDkk", value)}
              value={form.psa7MarketDkk}
            />
            <Field
              inputMode="decimal"
              label="PSA 8 DKK"
              onChange={(value) => onChange("psa8MarketDkk", value)}
              value={form.psa8MarketDkk}
            />
            <Field
              inputMode="decimal"
              label="PSA 9 DKK"
              onChange={(value) => onChange("psa9MarketDkk", value)}
              value={form.psa9MarketDkk}
            />
            <Field
              inputMode="decimal"
              label="PSA 9.5 DKK"
              onChange={(value) => onChange("psa95MarketDkk", value)}
              value={form.psa95MarketDkk}
            />
            <Field
              inputMode="decimal"
              label="PSA 10 DKK"
              onChange={(value) => onChange("psa10MarketDkk", value)}
              value={form.psa10MarketDkk}
            />
          </div>
          <Field label="Card name" onChange={(value) => onChange("cardName", value)} value={form.cardName} />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Set" onChange={(value) => onChange("setName", value)} value={form.setName} />
            <Field label="Card number" onChange={(value) => onChange("cardNumber", value)} value={form.cardNumber} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Store" onChange={(value) => onChange("store", value)} value={form.store} />
            <Field label="City" onChange={(value) => onChange("city", value)} value={form.city} />
          </div>
          <p className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-muted">
            Store and city are remembered for the next cards until you change them.
          </p>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-muted">Notes</span>
            <textarea
              className="input-shell min-h-20 w-full rounded-lg px-3 py-2 text-base outline-none focus:border-text"
              onChange={(event) => onChange("notes", event.target.value)}
              value={form.notes}
            />
          </label>
          <p className="text-xs text-muted">Cost = yen / {settings.yenDivisor}</p>
        </div>
      ) : null}
    </section>
  );
}

function SourceChips({
  sources,
  sourceUrls,
}: {
  sources: ReferenceSource[];
  sourceUrls?: ReferenceValues["sourceUrls"];
}) {
  const labels: Array<{ source: ReferenceSource; label: string }> = [
    { source: "cardmarket", label: "Cardmarket" },
    { source: "tcgplayer", label: "TCGplayer" },
    { source: "pricecharting", label: "PriceCharting" },
    { source: "pokeprices", label: "PokePrices" },
    { source: "manual", label: "Manual" },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {labels.map((item) => {
        const active = sources.includes(item.source);
        const url = sourceUrls?.[item.source];
        const className = `inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium ${
          active
            ? "border-text/40 bg-strong text-text"
            : "border-border bg-surface text-secondary"
        }`;

        if (active && url) {
          return (
            <a
              className={className}
              href={url}
              key={item.source}
              rel="noreferrer"
              target="_blank"
            >
              {item.label}
              <ExternalLink aria-hidden="true" className="h-3 w-3" />
            </a>
          );
        }

        return (
          <span
            className={className}
            key={item.source}
          >
            {item.label}
          </span>
        );
      })}
    </div>
  );
}

function HistoryScreen({
  deals,
  onDelete,
  onStatus,
  totalBoughtDkk,
  totalBoughtYen,
}: {
  deals: SavedDeal[];
  onDelete: (id: string) => void;
  onStatus: (id: string, status: DealStatus) => void;
  totalBoughtDkk: number;
  totalBoughtYen: number;
}) {
  return (
    <section className="space-y-3">
      <ScreenTitle subtitle="Saved shop checks" title="History" />
      <section className="card p-3">
        <p className="text-sm text-muted">Bought total</p>
        <p className="mt-1 text-xl font-semibold">{formatYen(totalBoughtYen)}</p>
        <p className="text-sm text-muted">{formatMoney(totalBoughtDkk)}</p>
      </section>

      <div className="grid gap-1.5">
        {deals.length === 0 ? (
          <EmptyState text="No saved deals yet." />
        ) : (
          deals.map((deal) => (
            <article className="card p-3" key={deal.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 gap-3">
                  <CardThumb imageUrl={deal.imageUrl} name={deal.cardName} />
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold">{deal.cardName}</h3>
                    <p className="truncate text-xs text-muted">
                      {[deal.setName, deal.cardNumber].filter(Boolean).join(" - ")}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {CONDITION_LABELS[deal.inHandCondition]} - {formatYen(deal.shopPriceYen)} - {formatMoney(deal.costDkk)}
                    </p>
                  </div>
                </div>
                <DecisionBadge decision={deal.decision} />
              </div>

              <div className="mt-3 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">
                  {formatPercent(deal.marginPercent)}
                </p>
                <div className="segmented-mini">
                  {(["seen", "bought", "skipped"] as DealStatus[]).map((status) => (
                    <button
                      className={normalizeStatus(deal.status) === status ? "active" : ""}
                      key={status}
                      onClick={() => onStatus(deal.id, status)}
                      type="button"
                    >
                      {status}
                    </button>
                  ))}
                </div>
                <button
                  aria-label={`Delete ${deal.cardName}`}
                  className="icon-button danger"
                  onClick={() => onDelete(deal.id)}
                  type="button"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function SettingsScreen({
  onChange,
  onReset,
  settings,
}: {
  onChange: (field: keyof AppSettings, value: string) => void;
  onReset: () => void;
  settings: AppSettings;
}) {
  return (
    <section className="space-y-3">
      <ScreenTitle subtitle="Simple in-store formula" title="Settings" />
      <section className="card p-3">
        <p className="text-sm text-muted">Formula</p>
        <p className="mt-1 text-base font-semibold">Cost = yen / {settings.yenDivisor}</p>
        <p className="text-sm text-muted">
          Net keeps {Math.round((1 - settings.sellingFee) * 100)}% after fee
        </p>
        <p className="text-sm text-muted">
          Grading adds {formatMoney(settings.gradingFeeDkk)}
        </p>
      </section>

      <div className="grid gap-2">
        <SettingNumberField
          field="yenDivisor"
          key={`yenDivisor-${settings.yenDivisor}`}
          label="Yen divisor"
          onCommit={onChange}
          value={settings.yenDivisor}
        />
        <SettingNumberField
          field="sellingFee"
          key={`sellingFee-${settings.sellingFee}`}
          label="Selling fee"
          onCommit={onChange}
          placeholder="0.05"
          value={settings.sellingFee}
        />
        <SettingNumberField
          field="gradingFeeDkk"
          key={`gradingFeeDkk-${settings.gradingFeeDkk}`}
          label="PSA grading fee"
          onCommit={onChange}
          value={settings.gradingFeeDkk}
        />
      </div>
      <button className="button-secondary h-10 w-full" onClick={onReset} type="button">
        <RotateCcw size={16} />
        Reset defaults
      </button>
    </section>
  );
}

function SettingNumberField({
  field,
  label,
  onCommit,
  placeholder,
  value,
}: {
  field: keyof AppSettings;
  label: string;
  onCommit: (field: keyof AppSettings, value: string) => void;
  placeholder?: string;
  value: number;
}) {
  const [draft, setDraft] = useState(settingNumberDraft(value));

  function commitDraft() {
    const trimmed = draft.trim();
    if (!trimmed) {
      setDraft(settingNumberDraft(value));
      return;
    }

    const parsed = cleanNumber(trimmed);
    if (!Number.isFinite(parsed) || (field === "yenDivisor" && parsed <= 0)) {
      setDraft(settingNumberDraft(value));
      return;
    }

    onCommit(field, trimmed);
  }

  return (
    <Field
      inputMode="decimal"
      label={label}
      onBlur={commitDraft}
      onChange={setDraft}
      onEnter={commitDraft}
      placeholder={placeholder}
      value={draft}
    />
  );
}

function settingNumberDraft(value: number): string {
  return Number.isFinite(value) ? String(value) : "";
}

function PsaSlabScreen({
  onOpenDealCheck,
}: {
  onOpenDealCheck: () => void;
}) {
  const [certInput, setCertInput] = useState("");
  const [scanMessage, setScanMessage] = useState("");
  const certNumber = cleanPsaCert(certInput);
  const psaUrl = buildPsaCertUrl(certNumber);

  async function scanImage(file: File | undefined) {
    if (!file) {
      return;
    }

    setScanMessage("Scanning PSA label...");
    try {
      const detected = await detectPsaCertFromImage(file);
      if (!detected) {
        setScanMessage("No PSA cert found. Enter the cert number manually.");
        return;
      }

      setCertInput(detected);
      setScanMessage(`Detected PSA cert ${detected}.`);
    } catch (error) {
      setScanMessage(
        error instanceof Error
          ? error.message
          : "Could not scan the PSA label. Enter the cert manually.",
      );
    }
  }

  return (
    <section className="space-y-3">
      <ScreenTitle subtitle="Check the cert on PSA" title="PSA Slab" />

      <section className="card p-3">
        <div className="mb-3 rounded-lg border border-border bg-background p-3">
          <p className="text-xs font-medium text-muted">PSA cert verification</p>
          <p className="mt-1 text-sm text-muted">Scan or enter the cert number.</p>
        </div>

        <Field
          inputMode="numeric"
          label="PSA cert number"
          onChange={setCertInput}
          placeholder="12345678"
          value={certInput}
        />

        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="button-secondary h-11">
            <Camera size={16} />
            Scan code
            <input
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(event) => scanImage(event.target.files?.[0])}
              type="file"
            />
          </label>
          <a
            className="button-primary h-11"
            href={psaUrl}
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLink size={16} />
            Open PSA
          </a>
        </div>

        {scanMessage ? (
          <p className="mt-3 rounded-lg border border-border bg-strong px-3 py-2 text-xs font-medium text-muted">
            {scanMessage}
          </p>
        ) : null}

        <WarningBox>
          PSA cert verification reduces risk but does not guarantee the
          slab/card is authentic. Compare the cert details and PSA photos, and
          inspect the slab and card.
        </WarningBox>
      </section>

      <button
        className="button-secondary h-10 w-full"
        onClick={onOpenDealCheck}
        type="button"
      >
        <Calculator size={16} />
        Check slab price
      </button>
    </section>
  );
}

function StickyDecisionBar({
  calculation,
  form,
}: {
  calculation: DealCalculation;
  form: DealForm;
}) {
  const statusText =
    calculation.displayState === "ready"
      ? `${calculation.route?.label ?? "Route"} / ${formatPercent(calculation.marginPercent)}`
      : !form.cardName
        ? "Select card"
        : calculation.displayState === "idle"
          ? "Enter shop price"
          : "Waiting for value";

  return (
    <section className="fixed inset-x-0 bottom-[calc(5.05rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-[428px] px-4">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-elevated px-3 py-2">
        <div className="min-w-0">
          <p className="text-xs text-muted">
            {formatMoney(calculation.costDkk)} - {CONDITION_LABELS[form.inHandCondition]}
          </p>
          <p className="truncate text-sm font-semibold">
            {statusText}
          </p>
        </div>
        {calculation.displayState === "ready" ? (
          <DecisionBadge decision={calculation.decision} />
        ) : null}
      </div>
    </section>
  );
}

function BottomNav({
  screen,
  setScreen,
}: {
  screen: Screen;
  setScreen: (screen: Screen) => void;
}) {
  return (
    <>
      <div aria-hidden="true" className="bottom-nav-backdrop" />
      <nav className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-[428px] px-4 pt-2 safe-bottom">
        <div className="grid grid-cols-4 rounded-lg border border-border bg-elevated p-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = screen === item.screen;

            return (
              <button
                className={`grid place-items-center gap-0.5 rounded-md py-2 text-[11px] font-semibold ${
                  active ? "bg-strong text-text" : "text-muted"
                }`}
                key={item.screen}
                onClick={() => setScreen(item.screen)}
                type="button"
              >
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}

function ConfirmSheet({
  body,
  confirmLabel,
  onCancel,
  onConfirm,
  title,
}: {
  body: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) {
  return (
    <div className="fixed inset-0 z-[70] grid place-items-end bg-black/60 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <section className="w-full max-w-[428px] rounded-lg border border-border bg-elevated p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-muted">{body}</p>
          </div>
          <button
            aria-label="Cancel"
            className="icon-button"
            onClick={onCancel}
            type="button"
          >
            <X size={16} />
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button className="button-secondary h-10" onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="button-danger h-10" onClick={onConfirm} type="button">
            <LockKeyhole size={16} />
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function ScreenTitle({ title }: { subtitle?: string; title: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold">{title}</h2>
    </div>
  );
}

function CardThumb({
  imageUrl,
  name,
}: {
  imageUrl?: string;
  name?: string;
}) {
  if (!imageUrl) {
    return (
      <span className="grid size-12 shrink-0 place-items-center rounded-lg border border-border bg-strong text-muted">
        <ScanLine size={18} />
      </span>
    );
  }

  return (
    <Image
      alt={name || "Card image"}
      className="h-14 w-10 shrink-0 rounded-lg object-cover"
      height={56}
      loading="lazy"
      src={imageUrl}
      unoptimized
      width={40}
    />
  );
}

function Field({
  autoFocus,
  inputMode = "text",
  label,
  onBlur,
  onChange,
  onEnter,
  placeholder,
  type = "text",
  value,
}: {
  autoFocus?: boolean;
  inputMode?: "text" | "decimal" | "numeric";
  label: string;
  onBlur?: () => void;
  onChange: (value: string) => void;
  onEnter?: () => void;
  placeholder?: string;
  type?: "text" | "password";
  value: string;
}) {
  return (
    <label className="grid min-w-0 gap-1.5">
      <span className="min-w-0 text-xs font-medium text-muted">{label}</span>
      <input
        autoFocus={autoFocus}
        autoCapitalize="none"
        autoCorrect="off"
        className="input-shell h-11 w-full rounded-lg px-3 text-base outline-none focus:border-text"
        inputMode={inputMode}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && onEnter) {
            onEnter();
            event.currentTarget.blur();
          }
        }}
        placeholder={placeholder}
        spellCheck={false}
        type={type}
        value={value}
      />
    </label>
  );
}

function ActionButton({
  children,
  icon: Icon,
  onClick,
  tone,
}: {
  children: ReactNode;
  icon: LucideIcon;
  onClick: () => void;
  tone: "primary" | "danger" | "neutral";
}) {
  const classes = {
    primary: "button-primary",
    danger: "button-danger",
    neutral: "button-secondary",
  };

  return (
    <button
      className={`${classes[tone]} h-11 min-w-0`}
      onClick={onClick}
      type="button"
    >
      <Icon size={15} />
      {children}
    </button>
  );
}

function DecisionBadge({ decision }: { decision: Decision }) {
  return (
    <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${decisionBadge(decision)}`}>
      {decision}
    </span>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-t border-border py-2 first:border-t-0">
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}

function WarningBox({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-sm font-semibold text-amber">
      {children}
    </p>
  );
}

function EmptyState({ text }: { text: string }) {
  return <section className="card p-4 text-center text-sm text-muted">{text}</section>;
}

function decisionBadge(decision: Decision): string {
  if (decision === "BUY") return "bg-green/15 text-green";
  if (decision === "MAYBE") return "bg-amber/15 text-amber";
  return "bg-red/15 text-red";
}

function decisionText(decision: Decision): string {
  if (decision === "BUY") return "text-green";
  if (decision === "MAYBE") return "text-amber";
  return "text-red";
}

type CardBackedScanCandidate = CardScanCandidate & { card: CardSearchResult };

function hasScannedCard(
  candidate: CardScanCandidate,
): candidate is CardBackedScanCandidate {
  return Boolean(candidate.card);
}

function cardsFromScanCandidates(
  candidates: CardScanCandidate[],
): CardSearchResult[] {
  const cards = candidates.filter(hasScannedCard).map((candidate) => candidate.card);
  const seen = new Set<string>();
  return cards.filter((card) => {
    if (seen.has(card.id)) {
      return false;
    }

    seen.add(card.id);
    return true;
  });
}

function cloudWarning(
  cloudResult: PromiseSettledResult<CardScanResponse>,
  cloud: CardScanResponse | undefined,
): string {
  if (cloudResult.status === "rejected") {
    return "Cloud scan request failed.";
  }

  return cloud?.warnings[0] ?? "";
}

async function scanPriceWithFallback(file: File): Promise<PriceOcrResponse> {
  try {
    return await scanPriceImage(file);
  } catch (error) {
    const text = await recognizePriceText(file);
    const scan = extractDealScan(text);
    return {
      prices: scan.yenPrice ? [scan.yenPrice] : [],
      source: "browser-tesseract",
      text,
      warning:
        error instanceof Error
          ? `GPU price OCR unavailable: ${error.message}`
          : "GPU price OCR unavailable.",
      yenPrice: scan.yenPrice,
    };
  }
}

function priceWarning(
  localTextResult: PromiseSettledResult<PriceOcrResponse>,
  priceScan: PriceOcrResponse | undefined,
): string {
  if (localTextResult.status === "rejected") {
    return "Price OCR failed. Enter shop price manually.";
  }

  if (priceScan?.yenPrice) {
    return priceScan.source === "browser-tesseract" && priceScan.warning
      ? priceScan.warning
      : "";
  }

  return [
    priceScan?.warning,
    "Price OCR did not find a yen price. Enter shop price manually.",
  ]
    .filter(Boolean)
    .join(" ");
}

function confidenceLabel(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function defaultLanguageForBucket(bucket: LanguageBucket): CardLanguage {
  return bucket === "asian" ? "ja" : "en";
}

function supportedCardLanguage(language: string): CardLanguage | undefined {
  return isSupportedCardLanguage(language) ? language : undefined;
}

function languageBucketForCardLanguage(language: string): LanguageBucket | undefined {
  if (!isSupportedCardLanguage(language)) {
    return undefined;
  }

  return LANGUAGE_OPTIONS.asian.includes(language) ? "asian" : "western";
}

function isSupportedCardLanguage(language: string): language is CardLanguage {
  return [...LANGUAGE_OPTIONS.asian, ...LANGUAGE_OPTIONS.western].includes(
    language as CardLanguage,
  );
}

function buildReferenceValues(
  form: DealForm,
  reference: ReferenceState,
  selectedCard: CardSearchResult | undefined,
): ReferenceValues {
  const manualRaw = optionalNumber(form.rawMarketDkk);
  const manualPsa7 = optionalNumber(form.psa7MarketDkk);
  const manualPsa8 = optionalNumber(form.psa8MarketDkk);
  const manualPsa9 = optionalNumber(form.psa9MarketDkk);
  const manualPsa95 = optionalNumber(form.psa95MarketDkk);
  const manualPsa10 = optionalNumber(form.psa10MarketDkk);
  const isManualOverride = Boolean(
    manualRaw ||
      manualPsa7 ||
      manualPsa8 ||
      manualPsa9 ||
      manualPsa95 ||
      manualPsa10,
  );
  const sources = new Set<ReferenceSource>(reference.sources);
  if (isManualOverride) {
    sources.add("manual");
  }
  const sourceUrls: ReferenceValues["sourceUrls"] = {
    ...(reference.sourceUrls ?? {}),
  };
  const cardmarketUrl = buildCurrentCardmarketUrl(form, selectedCard);
  if (cardmarketUrl) {
    sources.add("cardmarket");
    sourceUrls.cardmarket =
      reference.rawFilterStatus === "live_filtered" && reference.sourceUrls?.cardmarket
        ? reference.sourceUrls.cardmarket
        : cardmarketUrl;
  }
  const rawFilterStatus = manualRaw
    ? "manual"
    : reference.isFetching && cardmarketUrl
      ? "fetching_filtered"
      : reference.rawFilterStatus;

  return {
    rawDkk: manualRaw ?? (reference.isFetching ? undefined : reference.rawDkk),
    psa7Dkk: manualPsa7 ?? reference.psa7Dkk,
    psa8Dkk: manualPsa8 ?? reference.psa8Dkk,
    psa9Dkk: manualPsa9 ?? reference.psa9Dkk,
    psa95Dkk: manualPsa95 ?? reference.psa95Dkk,
    psa10Dkk: manualPsa10 ?? reference.psa10Dkk,
    rawSource: manualRaw ? "manual" : reference.rawSource,
    rawFilterStatus,
    rawPriceNote:
      manualRaw || reference.isFetching ? undefined : reference.rawPriceNote,
    psa7Source: manualPsa7 ? "manual" : reference.psa7Source,
    psa8Source: manualPsa8 ? "manual" : reference.psa8Source,
    psa9Source: manualPsa9 ? "manual" : reference.psa9Source,
    psa95Source: manualPsa95 ? "manual" : reference.psa95Source,
    psa10Source: manualPsa10 ? "manual" : reference.psa10Source,
    sources: Array.from(sources),
    sourceUrls,
    fetchedAt: reference.fetchedAt,
    isManualOverride,
  };
}

function buildCurrentCardmarketUrl(
  form: DealForm,
  selectedCard: CardSearchResult | undefined,
): string | undefined {
  if (!form.cardName && !selectedCard?.name) {
    return undefined;
  }

  return buildCardmarketSearchUrl(
    {
      cardNumber: form.cardNumber || selectedCard?.cardNumber,
      id: selectedCard?.id,
      name: form.cardName || selectedCard?.name,
      setId:
        selectedCard?.tcgDexSetId ??
        selectedCard?.pokemonTcgSetId ??
        setIdFromCardId(selectedCard?.id ?? ""),
      setName: form.setName || selectedCard?.setName,
    },
    {
      language: form.cardLanguage,
      minCondition: "NM",
    },
  );
}

function setIdFromCardId(id: string): string {
  const match = id.match(/^(.+)-[^-]+$/);
  return match?.[1] ?? "";
}

function createSavedDeal(
  form: DealForm,
  calculation: DealCalculation,
  values: ReferenceValues,
  status: DealStatus,
): SavedDeal {
  return {
    id: makeId(),
    cardName: form.cardName.trim() || "Unnamed card",
    setName: form.setName.trim(),
    cardNumber: form.cardNumber.trim(),
    imageUrl: form.imageUrl,
    inHandCondition: form.inHandCondition,
    rawCondition: normalizeRawCondition(form.rawCondition),
    languageBucket: form.languageBucket,
    cardLanguage: form.cardLanguage,
    shopPriceYen: cleanNumber(form.shopPriceYen),
    costDkk: calculation.costDkk,
    referenceValueUsedDkk: calculation.referenceValueUsedDkk,
    netReferenceValueDkk: calculation.netReferenceValueDkk,
    rawMarketDkk: values.rawDkk,
    psa7MarketDkk: values.psa7Dkk,
    psa8MarketDkk: values.psa8Dkk,
    psa9MarketDkk: values.psa9Dkk,
    psa95MarketDkk: values.psa95Dkk,
    psa10MarketDkk: values.psa10Dkk,
    profitDkk: calculation.profitDkk,
    marginPercent: calculation.marginPercent,
    decision: calculation.decision,
    warning: calculation.warning,
    store: form.store.trim(),
    city: form.city.trim(),
    notes: form.notes.trim(),
    status,
    createdAt: new Date().toISOString(),
  };
}

function normalizeStatus(status: unknown): DealStatus {
  if (status === "Bought" || status === "bought") return "bought";
  if (status === "Skipped" || status === "skipped") return "skipped";
  return "seen";
}

function cleanPsaCert(value: string): string {
  const fromUrl = extractPsaCert(value);
  if (fromUrl) {
    return fromUrl;
  }

  return value.replace(/\D/g, "").slice(0, 12);
}

function extractPsaCert(value: string): string {
  const decoded = safeDecode(value);
  const urlMatch = decoded.match(/psacard\.com\/cert\/(\d{5,12})/i);
  if (urlMatch) {
    return urlMatch[1];
  }

  return decoded.match(/\b\d{6,12}\b/)?.[0] ?? "";
}

function buildPsaCertUrl(certNumber: string): string {
  return certNumber
    ? `https://www.psacard.com/cert/${certNumber}/psa`
    : "https://www.psacard.com/cert";
}

async function detectPsaCertFromImage(file: File): Promise<string> {
  const Detector = (
    window as Window & {
      BarcodeDetector?: new (options?: { formats?: string[] }) => {
        detect: (source: HTMLImageElement) => Promise<Array<{ rawValue: string }>>;
      };
    }
  ).BarcodeDetector;

  if (!Detector) {
    throw new Error(
      "This browser cannot scan PSA QR/barcodes here. Enter the cert manually.",
    );
  }

  const detector = new Detector({
    formats: ["qr_code", "code_128", "code_39", "ean_13"],
  });
  const image = await loadImage(file);
  const codes = await detector.detect(image);
  for (const code of codes) {
    const cert = extractPsaCert(code.rawValue);
    if (cert) {
      return cert;
    }
  }

  return "";
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new window.Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read the image. Enter the cert manually."));
    };
    image.src = url;
  });
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
