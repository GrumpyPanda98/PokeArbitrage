"use client";

import LiquidGlass from "liquid-glass-react";
import Image from "next/image";
import { createPortal } from "react-dom";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  Calculator,
  Camera,
  Clock3,
  ExternalLink,
  Home,
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
  settings: "pokearb.settings.v2",
  theme: "pokearb.theme.v1",
  liquidBackground: "pokearb.liquid-background.v1",
  history: "pokearb.deals.v2",
  storeContext: "pokearb.store-context.v1",
};

const EMPTY_HISTORY: SavedDeal[] = [];

const EMPTY_REFERENCE_STATE: ReferenceState = {
  sources: [],
  isFetching: false,
};

const DEFAULT_STORE_CONTEXT: StoreContext = {
  store: "",
  city: "Tokyo",
};

type ThemeName = "graphite" | "wooper" | "paper" | "liquid";
type LiquidBackgroundName =
  | "psyduck"
  | "dragonite"
  | "froakie"
  | "quagsire"
  | "typhlosion"
  | "woah";

const DEFAULT_THEME: ThemeName = "graphite";
const DEFAULT_LIQUID_BACKGROUND: LiquidBackgroundName = "psyduck";
const ThemeContext = createContext<ThemeName>(DEFAULT_THEME);
type LiquidMotionState = {
  globalMousePos: { x: number; y: number };
  mouseOffset: { x: number; y: number };
};
const DEFAULT_LIQUID_MOTION: LiquidMotionState = {
  globalMousePos: { x: 1, y: 1 },
  mouseOffset: { x: 0, y: 0 },
};
const LiquidMotionContext = createContext<LiquidMotionState>(
  DEFAULT_LIQUID_MOTION,
);

const THEME_OPTIONS: Array<{
  description: string;
  name: ThemeName;
  swatches: string[];
  title: string;
}> = [
  {
    description: "Flat black",
    name: "graphite",
    swatches: ["#000000", "#171717", "#ededed"],
    title: "Graphite",
  },
  {
    description: "Warm brown",
    name: "wooper",
    swatches: ["#16110f", "#2a211c", "#d2b199"],
    title: "Wooper",
  },
  {
    description: "Bright and plain",
    name: "paper",
    swatches: ["#f7f5f0", "#ffffff", "#18130f"],
    title: "Paper",
  },
  {
    description: "Refracted glass",
    name: "liquid",
    swatches: ["#050708", "#20302c", "#eef6ef"],
    title: "Liquid",
  },
];

const LIQUID_BACKGROUND_OPTIONS: Array<{
  name: LiquidBackgroundName;
  position: string;
  src: string;
  title: string;
}> = [
  {
    name: "psyduck",
    position: "center center",
    src: "/backgrounds/psyduck.jpg",
    title: "Psyduck",
  },
  {
    name: "dragonite",
    position: "center top",
    src: "/backgrounds/dragonite.jpg",
    title: "Dragonite",
  },
  {
    name: "froakie",
    position: "center center",
    src: "/backgrounds/froakie.jpg",
    title: "Froakie",
  },
  {
    name: "quagsire",
    position: "center bottom",
    src: "/backgrounds/quagsire.jpg",
    title: "Quagsire",
  },
  {
    name: "typhlosion",
    position: "center center",
    src: "/backgrounds/typhlosion.jpg",
    title: "Typhlosion",
  },
  {
    name: "woah",
    position: "center center",
    src: "/backgrounds/woah.jpg",
    title: "Woah",
  },
];

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
  const [storedSettings, setSettings] = useLocalStorageState(
    STORAGE_KEYS.settings,
    DEFAULT_SETTINGS,
  );
  const settings = useMemo(
    () => normalizeSettings(storedSettings),
    [storedSettings],
  );
  const [storedTheme, setTheme] = useLocalStorageState<ThemeName>(
    STORAGE_KEYS.theme,
    DEFAULT_THEME,
  );
  const theme = normalizeTheme(storedTheme);
  const liquidMotion = useLiquidMotionState(theme === "liquid");
  const [storedLiquidBackground, setLiquidBackground] =
    useLocalStorageState<LiquidBackgroundName>(
      STORAGE_KEYS.liquidBackground,
      DEFAULT_LIQUID_BACKGROUND,
    );
  const liquidBackground = normalizeLiquidBackground(storedLiquidBackground);
  const selectedLiquidBackground = liquidBackgroundOption(liquidBackground);
  const liquidBackgroundStyle = useMemo(
    () =>
      ({
        "--liquid-background-image": `url("${selectedLiquidBackground.src}")`,
        "--liquid-background-position": selectedLiquidBackground.position,
      }) as CSSProperties,
    [selectedLiquidBackground],
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
  const [notice, setNotice] = useState("");
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
    return (
      <main
        aria-hidden="true"
        className="app-shell min-h-screen"
        data-theme={DEFAULT_THEME}
      />
    );
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

  return (
    <ThemeContext.Provider value={theme}>
      <LiquidMotionContext.Provider value={liquidMotion}>
        <main
          className="app-shell"
          data-liquid-background={liquidBackground}
          data-theme={theme}
          style={theme === "liquid" ? liquidBackgroundStyle : undefined}
        >
          <div className="app-content mx-auto min-h-screen max-w-[428px] px-4 pb-[calc(14rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))]">
            <AppHeader setScreen={setScreen} />

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
                onLiquidBackgroundChange={setLiquidBackground}
                onThemeChange={setTheme}
                liquidBackground={liquidBackground}
                settings={settings}
                theme={theme}
              />
            ) : null}
          </div>

          {screen === "deal-check" && cleanNumber(form.shopPriceYen) > 0 ? (
            <StickyDecisionBar calculation={calculation} form={form} />
          ) : null}
          <BottomNav screen={screen} setScreen={setScreen} />
        </main>
      </LiquidMotionContext.Provider>
    </ThemeContext.Provider>
  );
}

function useIsLiquidTheme(): boolean {
  return useContext(ThemeContext) === "liquid";
}

function useLiquidMotionState(enabled: boolean): LiquidMotionState {
  const [motion, setMotion] = useState<LiquidMotionState>(
    DEFAULT_LIQUID_MOTION,
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let animationFrame = 0;
    let lastScrollY = window.scrollY;
    let lastScrollTime = performance.now();
    let pointer = {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    };

    function publish(nextPointer = pointer, scrollKick = 0) {
      pointer = nextPointer;
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        const width = Math.max(window.innerWidth, 1);
        const height = Math.max(window.innerHeight, 1);
        const offsetX = ((pointer.x / width) - 0.5) * 100;
        const offsetY = ((pointer.y / height) - 0.5) * 100 + scrollKick;

        setMotion({
          globalMousePos: {
            x: Math.max(1, pointer.x),
            y: Math.max(1, pointer.y),
          },
          mouseOffset: {
            x: clamp(offsetX, -48, 48),
            y: clamp(offsetY, -48, 48),
          },
        });
      });
    }

    function handlePointerMove(event: PointerEvent) {
      publish({ x: event.clientX, y: event.clientY });
    }

    function handleTouchMove(event: TouchEvent) {
      const touch = event.touches[0];
      if (!touch) {
        return;
      }

      publish({ x: touch.clientX, y: touch.clientY });
    }

    function handleScroll() {
      const now = performance.now();
      const delta = window.scrollY - lastScrollY;
      const elapsed = Math.max(now - lastScrollTime, 16);
      lastScrollY = window.scrollY;
      lastScrollTime = now;
      publish(pointer, clamp((delta / elapsed) * 60, -32, 32));
    }

    publish(pointer);
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll, { passive: true });

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, [enabled]);

  return enabled ? motion : DEFAULT_LIQUID_MOTION;
}

function CardPanel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const isLiquidTheme = useIsLiquidTheme();
  const surfaceRef = useRef<HTMLElement | null>(null);

  if (!isLiquidTheme) {
    return <section className={`card ${className}`}>{children}</section>;
  }

  return (
    <section
      className={`liquid-glass-panel ${className}`}
      ref={(node) => {
        surfaceRef.current = node;
      }}
    >
      <LiquidGlassSurface
        cornerRadius={32}
        mouseContainer={surfaceRef}
      />
      <div className="liquid-glass-content">
        {children}
      </div>
    </section>
  );
}

function ArticlePanel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const isLiquidTheme = useIsLiquidTheme();
  const surfaceRef = useRef<HTMLElement | null>(null);

  if (!isLiquidTheme) {
    return <article className={`card ${className}`}>{children}</article>;
  }

  return (
    <article
      className={`liquid-glass-panel ${className}`}
      ref={(node) => {
        surfaceRef.current = node;
      }}
    >
      <LiquidGlassSurface
        cornerRadius={32}
        mouseContainer={surfaceRef}
      />
      <div className="liquid-glass-content">
        {children}
      </div>
    </article>
  );
}

function LiquidGlassSurface({
  cornerRadius = 32,
  intensity = "panel",
  mouseContainer,
}: {
  cornerRadius?: number;
  intensity?: "panel" | "chrome" | "nested";
  mouseContainer: RefObject<HTMLElement | null>;
}) {
  const liquidMotion = useContext(LiquidMotionContext);
  const config =
    intensity === "chrome"
      ? {
          aberrationIntensity: 3,
          blurAmount: 0.07,
          displacementScale: 135,
          elasticity: 0.42,
          mode: "prominent" as const,
          overLight: false,
          saturation: 165,
        }
      : intensity === "nested"
        ? {
            aberrationIntensity: 2.6,
            blurAmount: 0.058,
            displacementScale: 108,
            elasticity: 0.28,
            mode: "prominent" as const,
            overLight: false,
            saturation: 158,
          }
        : {
          aberrationIntensity: 3.8,
          blurAmount: 0.09,
          displacementScale: 188,
          elasticity: 0.18,
          mode: "prominent" as const,
          overLight: false,
          saturation: 172,
        };

  return (
    <div
      aria-hidden="true"
      className={`liquid-glass-visual liquid-glass-${intensity}`}
    >
      <LiquidGlass
        aberrationIntensity={config.aberrationIntensity}
        blurAmount={config.blurAmount}
        className="liquid-glass-native"
        cornerRadius={cornerRadius}
        displacementScale={config.displacementScale}
        elasticity={config.elasticity}
        globalMousePos={liquidMotion.globalMousePos}
        mode={config.mode}
        mouseOffset={liquidMotion.mouseOffset}
        mouseContainer={mouseContainer}
        overLight={config.overLight}
        padding="0"
        saturation={config.saturation}
        style={{
          height: "100%",
          left: "50%",
          position: "absolute",
          top: "50%",
          width: "100%",
        }}
      >
        <span className="liquid-glass-fill" />
      </LiquidGlass>
    </div>
  );
}

function AppHeader({ setScreen }: { setScreen: (screen: Screen) => void }) {
  return (
    <header className="mb-3 flex items-center justify-between">
      <button className="text-left" onClick={() => setScreen("home")} type="button">
        <p className="text-base font-semibold leading-6">CardScope</p>
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
      <CardPanel className="px-3 py-2">
        <p className="text-xs text-muted">Approx. conversion</p>
        <p className="text-sm font-semibold">
          ¥1,000 ≈ {formatMoney(1000 / settings.yenDivisor)}
        </p>
      </CardPanel>

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
  const isLiquidTheme = useIsLiquidTheme();
  const surfaceRef = useRef<HTMLElement | null>(null);

  if (!isLiquidTheme) {
    return (
      <button
        aria-label={label}
        className="card flex min-h-20 p-3 text-left"
        onClick={() => setScreen(screen)}
        type="button"
      >
        <span className="flex h-full w-full flex-col items-start justify-between">
          <Icon className="text-muted" size={20} />
          <span>
            <span className="block text-sm font-semibold">{label}</span>
            {subtitle ? <span className="block text-xs text-muted">{subtitle}</span> : null}
          </span>
        </span>
      </button>
    );
  }

  return (
    <button
      aria-label={label}
      className="liquid-glass-panel flex min-h-20 p-3 text-left"
      onClick={() => setScreen(screen)}
      ref={(node) => {
        surfaceRef.current = node;
      }}
      type="button"
    >
      <LiquidGlassSurface
        cornerRadius={32}
        intensity="chrome"
        mouseContainer={surfaceRef}
      />
      <span className="liquid-glass-content flex h-full w-full flex-col items-start justify-between">
        <Icon className="text-muted" size={20} />
        <span>
          <span className="block text-sm font-semibold">{label}</span>
          {subtitle ? <span className="block text-xs text-muted">{subtitle}</span> : null}
        </span>
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

      <CardPanel className="p-3">
        <CardSearchCombobox
          languageBucket={form.languageBucket}
          onSelectCard={onSelectCard}
          preferredLanguage={form.cardLanguage}
        />
        {form.cardName ? <SelectedCardSummary form={form} /> : null}
      </CardPanel>

      <ShopPriceInput
        costDkk={calculation.costDkk}
        onChange={(value) => onChange("shopPriceYen", value)}
        value={form.shopPriceYen}
      />

      <MainDecisionCard
        calculation={calculation}
        condition={form.inHandCondition}
        sellingFee={settings.sellingFee}
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
      <div aria-hidden="true" className="deal-bottom-spacer" />
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
    <CardPanel className="p-3">
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
    </CardPanel>
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
    <CardPanel className="p-3">
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
    </CardPanel>
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
  const theme = useContext(ThemeContext);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CardSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [dropdownGeometry, setDropdownGeometry] = useState<{
    left: number;
    maxHeight: number;
    top: number;
    width: number;
  } | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const measureFrame = useRef<number | null>(null);
  const measureTimeouts = useRef<number[]>([]);
  const searchSequence = useRef(0);

  const updateDropdownGeometry = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) {
      return;
    }

    const rect = anchor.getBoundingClientRect();
    const visualViewport = window.visualViewport;
    const viewportPadding = 16;
    const viewportLeft = visualViewport?.offsetLeft ?? 0;
    const viewportTop = visualViewport?.offsetTop ?? 0;
    const viewportWidth = visualViewport?.width ?? window.innerWidth;
    const viewportHeight = visualViewport?.height ?? window.innerHeight;
    const top = Math.round(rect.bottom + viewportTop + 8);
    const width = Math.min(rect.width, viewportWidth - viewportPadding * 2);
    const left = Math.min(
      Math.max(viewportLeft + viewportPadding, rect.left + viewportLeft),
      viewportLeft + viewportWidth - viewportPadding - width,
    );
    const bottomLimit = viewportTop + viewportHeight - viewportPadding;
    setDropdownGeometry({
      left: Math.round(left),
      maxHeight: Math.max(156, Math.min(320, bottomLimit - top)),
      top,
      width,
    });
  }, []);

  const clearScheduledDropdownMeasures = useCallback(() => {
    if (measureFrame.current !== null) {
      window.cancelAnimationFrame(measureFrame.current);
      measureFrame.current = null;
    }

    measureTimeouts.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    measureTimeouts.current = [];
  }, []);

  const scheduleDropdownGeometry = useCallback(() => {
    updateDropdownGeometry();

    if (measureFrame.current !== null) {
      window.cancelAnimationFrame(measureFrame.current);
    }

    measureFrame.current = window.requestAnimationFrame(() => {
      measureFrame.current = null;
      updateDropdownGeometry();
    });

    measureTimeouts.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    measureTimeouts.current = [80, 180, 360, 620].map((delay) =>
      window.setTimeout(updateDropdownGeometry, delay),
    );
  }, [updateDropdownGeometry]);

  const runSearch = useCallback(async (value: string, emptyMessage: string) => {
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      if (emptyMessage) {
        setError(emptyMessage);
      }
      setResults([]);
      setOpen(Boolean(emptyMessage));
      if (emptyMessage) {
        scheduleDropdownGeometry();
      }
      return;
    }

    const sequence = searchSequence.current + 1;
    searchSequence.current = sequence;
    setLoading(true);
    setError("");
    setOpen(true);
    scheduleDropdownGeometry();
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
  }, [languageBucket, preferredLanguage, scheduleDropdownGeometry]);

  useEffect(() => {
    if (!open) {
      clearScheduledDropdownMeasures();
      return;
    }

    scheduleDropdownGeometry();
    const visualViewport = window.visualViewport;
    window.addEventListener("resize", updateDropdownGeometry, { passive: true });
    window.addEventListener("scroll", updateDropdownGeometry, true);
    visualViewport?.addEventListener("resize", scheduleDropdownGeometry, { passive: true });
    visualViewport?.addEventListener("scroll", updateDropdownGeometry, { passive: true });

    return () => {
      clearScheduledDropdownMeasures();
      window.removeEventListener("resize", updateDropdownGeometry);
      window.removeEventListener("scroll", updateDropdownGeometry, true);
      visualViewport?.removeEventListener("resize", scheduleDropdownGeometry);
      visualViewport?.removeEventListener("scroll", updateDropdownGeometry);
    };
  }, [
    clearScheduledDropdownMeasures,
    error,
    loading,
    open,
    results.length,
    scheduleDropdownGeometry,
    updateDropdownGeometry,
  ]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

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

  useEffect(() => {
    return clearScheduledDropdownMeasures;
  }, [clearScheduledDropdownMeasures]);

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

  const dropdown =
    open && dropdownGeometry && typeof document !== "undefined"
      ? createPortal(
          <div
            className="search-results-portal fixed overflow-auto rounded-lg border border-border bg-elevated"
            data-theme={theme}
            style={{
              left: dropdownGeometry.left,
              maxHeight: dropdownGeometry.maxHeight,
              top: dropdownGeometry.top,
              width: dropdownGeometry.width,
            }}
          >
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
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="relative" ref={anchorRef}>
      <form className="flex gap-2" onSubmit={search}>
        <label className="min-w-0 flex-1">
          <span className="sr-only">Search card</span>
          <input
            className="input-shell h-11 w-full rounded-lg px-3 text-base outline-none focus:border-text"
            onChange={(event) => {
              setQuery(event.target.value);
              if (open) {
                scheduleDropdownGeometry();
              }
            }}
            onFocus={() => {
              scheduleDropdownGeometry();
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

      {dropdown}
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
    <CardPanel className="p-3">
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
    </CardPanel>
  );
}

function MainDecisionCard({
  calculation,
  condition,
  sellingFee,
}: {
  calculation: DealCalculation;
  condition: InHandCondition;
  sellingFee: number;
}) {
  const isReady = calculation.displayState === "ready";
  const headline =
    calculation.displayState === "idle"
      ? "Enter shop price"
      : calculation.displayState === "missing"
        ? "Add reference value"
        : calculation.route?.label ?? CONDITION_LABELS[condition];

  return (
    <CardPanel className="p-3">
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
          label={`Buffer ${formatFeePercent(sellingFee)}`}
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
    </CardPanel>
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
    <CardPanel className="p-3">
      <h3 className="text-sm font-semibold">Routes</h3>
      <div className="mt-2 grid gap-1.5">
        {calculation.routes.map((route) => (
          <RouteResultRow key={route.id} route={route} />
        ))}
      </div>
    </CardPanel>
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
    <CardPanel className="p-3">
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
    </CardPanel>
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
    <CardPanel className="p-3">
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
    </CardPanel>
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
      <CardPanel className="p-3">
        <p className="text-sm text-muted">Bought total</p>
        <p className="mt-1 text-xl font-semibold">{formatYen(totalBoughtYen)}</p>
        <p className="text-sm text-muted">{formatMoney(totalBoughtDkk)}</p>
      </CardPanel>

      <div className="grid gap-1.5">
        {deals.length === 0 ? (
          <EmptyState text="No saved deals yet." />
        ) : (
          deals.map((deal) => (
            <ArticlePanel className="p-3" key={deal.id}>
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
            </ArticlePanel>
          ))
        )}
      </div>
    </section>
  );
}

function SettingsScreen({
  liquidBackground,
  onChange,
  onLiquidBackgroundChange,
  onReset,
  onThemeChange,
  settings,
  theme,
}: {
  liquidBackground: LiquidBackgroundName;
  onChange: (field: keyof AppSettings, value: string) => void;
  onLiquidBackgroundChange: (background: LiquidBackgroundName) => void;
  onReset: () => void;
  onThemeChange: (theme: ThemeName) => void;
  settings: AppSettings;
  theme: ThemeName;
}) {
  return (
    <section className="space-y-3">
      <ScreenTitle subtitle="Simple in-store formula" title="Settings" />
      <ThemeSelector onChange={onThemeChange} value={theme} />
      {theme === "liquid" ? (
        <LiquidBackgroundSelector
          onChange={onLiquidBackgroundChange}
          value={liquidBackground}
        />
      ) : null}

      <CardPanel className="p-3">
        <p className="text-sm text-muted">Formula</p>
        <p className="mt-1 text-base font-semibold">Cost = yen / {settings.yenDivisor}</p>
        <p className="text-sm text-muted">
          Buffer removes {formatFeePercent(settings.sellingFee)}
        </p>
        <p className="text-sm text-muted">
          Grading adds {formatMoney(settings.gradingFeeDkk)}
        </p>
      </CardPanel>

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
          label="Buffer %"
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

function LiquidBackgroundSelector({
  onChange,
  value,
}: {
  onChange: (background: LiquidBackgroundName) => void;
  value: LiquidBackgroundName;
}) {
  return (
    <CardPanel className="p-3">
      <p className="text-sm font-semibold">Liquid background</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {LIQUID_BACKGROUND_OPTIONS.map((background) => {
          const active = value === background.name;

          return (
            <button
              aria-pressed={active}
              className={`liquid-background-option overflow-hidden rounded-lg border text-left ${
                active ? "border-text/55 bg-strong" : "border-border bg-background"
              }`}
              key={background.name}
              onClick={() => onChange(background.name)}
              type="button"
            >
              <span
                aria-hidden="true"
                className="block h-16 bg-cover"
                style={{
                  backgroundImage: `url("${background.src}")`,
                  backgroundPosition: background.position,
                }}
              />
              <span className="block px-2 py-1.5 text-xs font-semibold">
                {background.title}
              </span>
            </button>
          );
        })}
      </div>
    </CardPanel>
  );
}

function ThemeSelector({
  onChange,
  value,
}: {
  onChange: (theme: ThemeName) => void;
  value: ThemeName;
}) {
  return (
    <CardPanel className="p-3">
      <p className="text-sm font-semibold">Theme</p>
      <div className="mt-2 grid gap-2">
        {THEME_OPTIONS.map((theme) => {
          const active = value === theme.name;

          return (
            <ThemeOptionButton
              active={active}
              key={theme.name}
              onClick={() => onChange(theme.name)}
              theme={theme}
            />
          );
        })}
      </div>
    </CardPanel>
  );
}

function ThemeOptionButton({
  active,
  onClick,
  theme,
}: {
  active: boolean;
  onClick: () => void;
  theme: (typeof THEME_OPTIONS)[number];
}) {
  const isLiquidTheme = useIsLiquidTheme();
  const surfaceRef = useRef<HTMLElement | null>(null);
  const content = (
    <span className="flex w-full items-center justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{theme.title}</span>
        <span className="block text-xs text-muted">{theme.description}</span>
      </span>
      <span className="flex shrink-0 overflow-hidden rounded-md border border-border">
        {theme.swatches.map((color, index) => (
          <span
            aria-hidden="true"
            className="h-5 w-5"
            key={`${theme.name}-${index}`}
            style={{ background: color }}
          />
        ))}
      </span>
    </span>
  );
  const buttonClassName = `theme-option flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left ${
    active
      ? "border-text/45 bg-strong"
      : "border-border bg-surface"
  }`;

  if (!isLiquidTheme) {
    return (
      <button
        className={buttonClassName}
        onClick={onClick}
        type="button"
      >
        {content}
      </button>
    );
  }

  return (
    <button
      className={`liquid-glass-panel ${buttonClassName}`}
      onClick={onClick}
      ref={(node) => {
        surfaceRef.current = node;
      }}
      type="button"
    >
      <LiquidGlassSurface
        cornerRadius={16}
        intensity="nested"
        mouseContainer={surfaceRef}
      />
      <span className="liquid-glass-content flex w-full">
        {content}
      </span>
    </button>
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function formatFeePercent(value: number): string {
  return `${new Intl.NumberFormat("da-DK", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(value * 100)}%`;
}

function normalizeTheme(value: unknown): ThemeName {
  return THEME_OPTIONS.some((theme) => theme.name === value)
    ? (value as ThemeName)
    : DEFAULT_THEME;
}

function normalizeLiquidBackground(value: unknown): LiquidBackgroundName {
  return LIQUID_BACKGROUND_OPTIONS.some(
    (background) => background.name === value,
  )
    ? (value as LiquidBackgroundName)
    : DEFAULT_LIQUID_BACKGROUND;
}

function liquidBackgroundOption(name: LiquidBackgroundName) {
  return (
    LIQUID_BACKGROUND_OPTIONS.find((background) => background.name === name) ??
    LIQUID_BACKGROUND_OPTIONS[0]
  );
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

      <CardPanel className="p-3">
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
      </CardPanel>

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
  const isLiquidTheme = useIsLiquidTheme();
  const surfaceRef = useRef<HTMLElement | null>(null);
  const statusText =
    calculation.displayState === "ready"
      ? `${calculation.route?.label ?? "Route"} / ${formatPercent(calculation.marginPercent)}`
      : !form.cardName
        ? "Select card"
        : calculation.displayState === "idle"
          ? "Enter shop price"
          : "Waiting for value";

  return (
    <section className="fixed inset-x-0 bottom-[calc(5.7rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-[428px] px-4">
      <div
        className={`decision-surface rounded-lg border border-border bg-elevated ${
          isLiquidTheme ? "liquid-glass-panel" : ""
        }`}
        ref={(node) => {
          surfaceRef.current = node;
        }}
      >
        {isLiquidTheme ? (
          <>
            <LiquidGlassSurface
              cornerRadius={18}
              intensity="chrome"
              mouseContainer={surfaceRef}
            />
            <div className="liquid-glass-content">
              <DecisionBarContent
                calculation={calculation}
                form={form}
                statusText={statusText}
              />
            </div>
          </>
        ) : (
          <DecisionBarContent
            calculation={calculation}
            form={form}
            statusText={statusText}
          />
        )}
      </div>
    </section>
  );
}

function DecisionBarContent({
  calculation,
  form,
  statusText,
}: {
  calculation: DealCalculation;
  form: DealForm;
  statusText: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
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
  );
}

function BottomNav({
  screen,
  setScreen,
}: {
  screen: Screen;
  setScreen: (screen: Screen) => void;
}) {
  const isLiquidTheme = useIsLiquidTheme();
  const surfaceRef = useRef<HTMLElement | null>(null);

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-[428px] px-4 pt-2 safe-bottom">
        <div
          className={`bottom-nav-surface rounded-lg border border-border bg-elevated ${
            isLiquidTheme ? "liquid-glass-panel" : ""
          }`}
          ref={(node) => {
            surfaceRef.current = node;
          }}
        >
          {isLiquidTheme ? (
            <>
              <LiquidGlassSurface
                cornerRadius={18}
                intensity="chrome"
                mouseContainer={surfaceRef}
              />
              <div className="liquid-glass-content">
                <BottomNavContent screen={screen} setScreen={setScreen} />
              </div>
            </>
          ) : (
            <BottomNavContent screen={screen} setScreen={setScreen} />
          )}
        </div>
      </nav>
    </>
  );
}

function BottomNavContent({
  screen,
  setScreen,
}: {
  screen: Screen;
  setScreen: (screen: Screen) => void;
}) {
  return (
    <div className="grid grid-cols-4 p-1">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = screen === item.screen;

        return (
          <button
            aria-label={item.label}
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
  return <CardPanel className="p-4 text-center text-sm text-muted">{text}</CardPanel>;
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
