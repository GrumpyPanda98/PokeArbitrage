import type {
  CardLanguage,
  Deal,
  InHandCondition,
  LanguageBucket,
  RawCardCondition,
  ReferenceValues,
} from "./calculations";

export type Screen =
  | "home"
  | "deal-check"
  | "psa"
  | "history"
  | "settings";

export type DealForm = {
  inHandCondition: InHandCondition;
  cardName: string;
  setName: string;
  cardNumber: string;
  imageUrl: string;
  shopPriceYen: string;
  rawCondition: RawCardCondition;
  languageBucket: LanguageBucket;
  cardLanguage: CardLanguage;
  rawMarketDkk: string;
  psa7MarketDkk: string;
  psa8MarketDkk: string;
  psa9MarketDkk: string;
  psa95MarketDkk: string;
  psa10MarketDkk: string;
  store: string;
  city: string;
  notes: string;
};

export type StoreContext = {
  store: string;
  city: string;
};

export type ReferenceState = ReferenceValues & {
  isFetching: boolean;
  error?: string;
};

export type SavedDeal = Deal;

export type StoredAppState = {
  settings: unknown;
  history: SavedDeal[];
};
