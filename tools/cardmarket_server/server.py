from __future__ import annotations

import atexit
import json
import logging
import os
import re
import threading
import time
from concurrent.futures import Future
from dataclasses import dataclass
from pathlib import Path
from queue import Queue
from typing import Any
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse

from bs4 import BeautifulSoup
from curl_cffi import requests as curl_requests
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from playwright.sync_api import Browser, BrowserContext, Page, Playwright
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env.local")
# A separate credentials file is opt-in; never borrow a sibling project's account.
if os.getenv("CARDMARKET_ENV_FILE"):
    load_dotenv(os.environ["CARDMARKET_ENV_FILE"])
load_dotenv(Path(__file__).resolve().parent / ".env")

CARDMARKET_BASE_URL = "https://www.cardmarket.com"
DEFAULT_LANGUAGE = os.getenv("POKEARB_CM_LANGUAGE", "en")
DEFAULT_GAME = os.getenv("POKEARB_CM_GAME", "Pokemon")
LOGIN_URL = f"{CARDMARKET_BASE_URL}/{DEFAULT_LANGUAGE}/{DEFAULT_GAME}/Users/login"
CONDITION_ORDER = ["MT", "NM", "EX", "GD", "LP", "PL", "PO"]
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)

logging.basicConfig(level=os.getenv("CARDMARKET_LOG_LEVEL", "INFO"))
logger = logging.getLogger("pokearb.cardmarket")

app = FastAPI(title="PokeArb Cardmarket Pricing", version="0.1.0")
_WORKER: CardmarketWorker | None = None
_WORKER_LOCK = threading.Lock()


class RawPriceRequest(BaseModel):
    cardName: str = ""
    cardNumber: str = ""
    idProduct: int | None = None
    language: str | None = None
    languageId: int | None = None
    minCondition: str | None = None
    minConditionId: int | None = None
    query: str
    searchUrl: str
    setId: str | None = None
    setName: str | None = None


@dataclass
class BrowserResponse:
    text: str
    url: str
    status_code: int
    headers: dict[str, str] | None = None

    def json(self) -> Any:
        return json.loads(self.text)


@dataclass
class Listing:
    article_id: str
    condition: str
    listing_url: str
    price: float
    seller: str


@dataclass
class WorkItem:
    request: RawPriceRequest
    future: Future[dict[str, Any]]


class CardmarketSession:
    def __init__(self) -> None:
        self._browser: Browser | None = None
        self._context: BrowserContext | None = None
        self._curl: curl_requests.Session | None = None
        self._logged_in = False
        self._page: Page | None = None
        self._playwright: Playwright | None = None
        atexit.register(self.close)

    def close(self) -> None:
        self._reset_browser(stop_playwright=True)

    def _reset_browser(self, stop_playwright: bool = False) -> None:
        try:
            if self._context:
                self._context.close()
            elif self._browser:
                self._browser.close()
            if stop_playwright and self._playwright:
                self._playwright.stop()
        except Exception:
            pass
        finally:
            self._browser = None
            self._context = None
            self._curl = None
            self._logged_in = False
            self._page = None
            if stop_playwright:
                self._playwright = None

    def get(self, url: str) -> BrowserResponse:
        self.ensure_logged_in()
        assert self._curl is not None

        try:
            response = self._curl.get(url, timeout=30)
            if response.status_code == 403 and is_cloudflare_challenge(response.text):
                logger.info("Cloudflare challenge for %s; refreshing cookies", url)
                self._sync_cookies_to_curl()
                response = self._curl.get(url, timeout=30)

            if 'name="userPassword"' in response.text:
                logger.info("Cardmarket session expired; logging in again")
                self._logged_in = False
                self.ensure_logged_in()
                response = self._curl.get(url, timeout=30)

            if response.status_code == 200 and not is_cloudflare_challenge(response.text):
                return BrowserResponse(
                    headers=dict(response.headers),
                    status_code=response.status_code,
                    text=response.text,
                    url=str(response.url),
                )
        except Exception as exc:
            logger.info("curl_cffi failed for %s: %s", url, exc)

        try:
            return self._get_via_browser(url)
        except PlaywrightError as exc:
            if "Target page, context or browser has been closed" not in str(exc):
                raise
            logger.info("Browser target closed for %s; restarting browser session", url)
            self._reset_browser()
            self.ensure_logged_in()
            return self._get_via_browser(url)

    def ensure_logged_in(self) -> None:
        if self._logged_in and self._page and not self._page.is_closed():
            return
        self._logged_in = False
        if not self.login():
            raise RuntimeError("Unable to log in to Cardmarket")

    def login(self) -> bool:
        username = os.getenv("CM_USERNAME")
        password = os.getenv("CM_PASSWORD")
        if not username or not password:
            raise RuntimeError("CM_USERNAME and CM_PASSWORD are required")

        if not self._browser or not self._page or self._page.is_closed():
            self._start_browser()

        assert self._page is not None
        try:
            self._page.goto(LOGIN_URL, wait_until="networkidle", timeout=60_000)
        except PlaywrightTimeoutError:
            logger.info("Login page networkidle timed out; continuing")

        html = self._page.content()
        if is_cloudflare_challenge(html):
            html = self._wait_for_challenge_clear(LOGIN_URL)

        if self._browser_is_logged_in(html):
            self._logged_in = True
            self._sync_cookies_to_curl()
            logger.info("Cardmarket login reused from browser profile")
            return True

        try:
            self._page.click(
                'button:has-text("ONLY REQUIRED COOKIES"), button:has-text("Only required")',
                timeout=5_000,
            )
        except PlaywrightTimeoutError:
            pass

        try:
            self._page.fill('input[name="username"]', username, timeout=10_000)
            self._page.fill('input[name="userPassword"]', password, timeout=10_000)
            self._page.click('input[type="submit"]')
        except PlaywrightTimeoutError:
            logger.error("Could not complete Cardmarket login form")
            return False

        try:
            self._page.wait_for_load_state("networkidle", timeout=20_000)
        except PlaywrightTimeoutError:
            logger.info("Login submit networkidle timed out; checking page state")

        if not self._browser_is_logged_in(self._page.content()):
            logger.error("Cardmarket login failed")
            return False

        self._logged_in = True
        self._sync_cookies_to_curl()
        logger.info("Cardmarket login successful")
        return True

    def _start_browser(self) -> None:
        if not self._playwright:
            self._playwright = sync_playwright().start()
        assert self._playwright is not None
        args = ["--disable-blink-features=AutomationControlled"]
        context_options = dict(
            java_script_enabled=True,
            locale="en-US",
            user_agent=USER_AGENT,
            viewport={"height": 800, "width": 1280},
        )

        if use_persistent_browser_profile():
            profile_dir = browser_profile_dir()
            profile_dir.mkdir(parents=True, exist_ok=True)
            self._context = self._playwright.chromium.launch_persistent_context(
                user_data_dir=str(profile_dir),
                headless=browser_headless(),
                args=args,
                **context_options,
            )
            self._browser = self._context.browser
            self._page = self._context.pages[0] if self._context.pages else self._context.new_page()
        else:
            self._browser = self._playwright.chromium.launch(
                headless=browser_headless(),
                args=args,
            )
            self._context = self._browser.new_context(**context_options)
            self._page = self._context.new_page()

        self._context.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
        )
        self._curl = curl_requests.Session(impersonate="safari17_0")

    def _sync_cookies_to_curl(self) -> None:
        assert self._context is not None
        if self._curl is None:
            self._curl = curl_requests.Session(impersonate="safari17_0")

        for cookie in self._context.cookies():
            self._curl.cookies.set(
                cookie["name"],
                cookie["value"],
                domain=cookie.get("domain", ""),
                path=cookie.get("path", "/"),
            )

    def _get_via_browser(self, url: str) -> BrowserResponse:
        assert self._page is not None
        try:
            self._page.goto(url, wait_until="networkidle", timeout=45_000)
        except PlaywrightTimeoutError:
            try:
                self._page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            except PlaywrightTimeoutError:
                pass
            self._page.wait_for_timeout(3_000)

        if self._page.query_selector('input[name="userPassword"]'):
            self._logged_in = False
            self.ensure_logged_in()
            self._page.goto(url, wait_until="domcontentloaded", timeout=30_000)

        html = self._page.content()
        if is_cloudflare_challenge(html):
            html = self._wait_for_challenge_clear(url)

        if is_cloudflare_challenge(html):
            raise RuntimeError(
                "Cardmarket Cloudflare challenge is blocking live pricing. "
                "Complete the visible browser challenge once, then retry."
            )

        self._sync_cookies_to_curl()
        return BrowserResponse(
            status_code=200,
            text=html,
            url=self._page.url,
        )

    def _wait_for_challenge_clear(self, url: str) -> str:
        assert self._page is not None
        wait_seconds = cloudflare_wait_seconds()
        logger.warning(
            "Cardmarket Cloudflare challenge for %s. Waiting up to %s seconds.",
            url,
            wait_seconds,
        )

        deadline = time.monotonic() + wait_seconds
        html = self._page.content()
        while time.monotonic() < deadline:
            if not is_cloudflare_challenge(html):
                self._sync_cookies_to_curl()
                return html
            self._page.wait_for_timeout(3_000)
            html = self._page.content()

        return html

    @staticmethod
    def _browser_is_logged_in(html: str) -> bool:
        soup = BeautifulSoup(html, "lxml")
        if soup.find("a", href=re.compile(r"/Users/logout|/Account/Logout", re.I)):
            return True
        if soup.find("span", string=re.compile(r"SELLING|BUYING", re.I)):
            return True
        return False


class CardmarketWorker:
    def __init__(self) -> None:
        self._queue: Queue[WorkItem] = Queue()
        self._session: CardmarketSession | None = None
        self._thread = threading.Thread(
            target=self._run,
            name="cardmarket-live-worker",
            daemon=True,
        )
        self._thread.start()
        atexit.register(self.close)

    @property
    def logged_in(self) -> bool:
        return bool(self._session and self._session._logged_in)

    def submit(self, request: RawPriceRequest) -> dict[str, Any]:
        future: Future[dict[str, Any]] = Future()
        self._queue.put(WorkItem(request=request, future=future))
        return future.result(timeout=worker_timeout_seconds())

    def close(self) -> None:
        if self._session:
            self._session.close()

    def _run(self) -> None:
        self._session = CardmarketSession()
        while True:
            item = self._queue.get()
            try:
                item.future.set_result(
                    fetch_lowest_live_listing_with_session(
                        self._session,
                        item.request,
                    )
                )
            except Exception as exc:
                if should_retry_with_fresh_browser(exc):
                    try:
                        logger.info("Retrying Cardmarket request with a fresh browser")
                        self._session._reset_browser()
                        item.future.set_result(
                            fetch_lowest_live_listing_with_session(
                                self._session,
                                item.request,
                            )
                        )
                        continue
                    except Exception as retry_exc:
                        item.future.set_exception(retry_exc)
                        continue

                item.future.set_exception(exc)


@app.get("/health")
def health() -> dict[str, Any]:
    worker = _WORKER
    return {
        "ok": True,
        "source": "cardmarket-live",
        "loggedIn": bool(worker and worker.logged_in),
    }


@app.post("/cardmarket/raw-price")
def raw_price(request: RawPriceRequest) -> JSONResponse:
    try:
        result = get_worker().submit(request)
        return JSONResponse(result)
    except Exception as exc:
        logger.exception("Cardmarket live price failed")
        return JSONResponse(
            {
                "error": str(exc),
                "ok": False,
                "query": request.query,
                "searchUrl": request.searchUrl,
            },
            status_code=200,
        )


def fetch_lowest_live_listing(request: RawPriceRequest) -> dict[str, Any]:
    session = CardmarketSession()
    try:
        return fetch_lowest_live_listing_with_session(session, request)
    finally:
        session.close()


def fetch_lowest_live_listing_with_session(
    session: CardmarketSession,
    request: RawPriceRequest,
) -> dict[str, Any]:
    product_url = resolve_product_url(session, request)
    filtered_product_url = apply_filters(product_url, request)
    response = session.get(filtered_product_url)
    soup = BeautifulSoup(response.text, "lxml")
    listings = extract_listings(soup, filtered_product_url, request.minCondition)

    if not listings:
        return {
            "error": "No matching listings found.",
            "ok": False,
            "productUrl": filtered_product_url,
            "query": request.query,
            "searchUrl": request.searchUrl,
        }

    lowest, exact_condition_count = select_reference_listing(
        listings,
        request.minCondition,
    )
    return {
        "condition": lowest.condition,
        "exactConditionListingCount": exact_condition_count,
        "exactConditionMatched": bool(
            request.minCondition and lowest.condition == request.minCondition
        ),
        "listingCount": len(listings),
        "listingUrl": lowest.listing_url,
        "ok": True,
        "productUrl": filtered_product_url,
        "query": request.query,
        "rawEur": lowest.price,
        "requestedCondition": request.minCondition,
        "searchUrl": request.searchUrl,
        "seller": lowest.seller,
    }


def select_reference_listing(
    listings: list[Listing],
    requested_condition: str | None,
) -> tuple[Listing, int | None]:
    if not requested_condition:
        return min(listings, key=lambda listing: listing.price), None

    exact_listings = [
        listing for listing in listings if listing.condition == requested_condition
    ]
    if exact_listings:
        return min(exact_listings, key=lambda listing: listing.price), len(exact_listings)

    return min(listings, key=lambda listing: listing.price), 0


def get_worker() -> CardmarketWorker:
    global _WORKER
    with _WORKER_LOCK:
        if _WORKER is None:
            _WORKER = CardmarketWorker()
        return _WORKER


def worker_timeout_seconds() -> int:
    try:
        value = int(os.getenv("CARDMARKET_WORKER_TIMEOUT_SECONDS", "180"))
    except ValueError:
        return 180
    return max(30, value)


def should_retry_with_fresh_browser(exc: Exception) -> bool:
    message = str(exc)
    return (
        "Target page, context or browser has been closed" in message
        or "launch_persistent_context" in message
    )


def resolve_product_url(session: CardmarketSession, request: RawPriceRequest) -> str:
    response = session.get(request.searchUrl)
    if "/Products/Singles/" in urlparse(response.url).path:
        return response.url

    soup = BeautifulSoup(response.text, "lxml")
    links = extract_product_links(soup, response.url)
    if not links:
        raise RuntimeError("Cardmarket search returned no product links")

    scored = [
        (score_product_link(link, request), link)
        for link in links
    ]
    scored.sort(key=lambda item: item[0], reverse=True)
    return scored[0][1]


def extract_product_links(soup: BeautifulSoup, base_url: str) -> list[str]:
    links: list[str] = []
    seen: set[str] = set()
    for link in soup.select('a[href*="/Pokemon/Products/Singles/"], a[href*="/Products/Singles/"]'):
        href = link.get("href", "")
        if not href:
            continue
        url = urljoin(base_url, href)
        url = strip_query_and_fragment(url)
        if url in seen:
            continue
        seen.add(url)
        links.append(url)
    return links


def score_product_link(url: str, request: RawPriceRequest) -> int:
    normalized_url = normalize_text(url)
    query_tokens = [normalize_text(token) for token in request.query.split()]
    card_tokens = [normalize_text(token) for token in request.cardName.split()]
    collector = normalize_text((request.cardNumber or "").split("/")[0])
    set_id = normalize_text(request.setId or "")

    score = 0
    for token in query_tokens:
        if token and token in normalized_url:
            score += 5
    for token in card_tokens:
        if token and token in normalized_url:
            score += 2
    if collector and collector in normalized_url:
        score += 8
    if set_id and set_id in normalized_url:
        score += 8
    return score


def apply_filters(url: str, request: RawPriceRequest) -> str:
    parsed = urlparse(url)
    params = dict(parse_qsl(parsed.query, keep_blank_values=True))

    if request.languageId:
        params["language"] = str(request.languageId)
    if request.minConditionId:
        params["minCondition"] = str(request.minConditionId)

    return urlunparse(parsed._replace(query=urlencode(params), fragment=""))


def extract_listings(
    soup: BeautifulSoup,
    product_url: str,
    min_condition: str | None,
) -> list[Listing]:
    listings: list[Listing] = []
    seen: set[str] = set()
    rows = soup.select(
        "[data-article-id], div.article-row, div.row.no-gutters[id^='article'], "
        "div[id^='articleRow'], tr[id^='article']"
    )

    for row in rows:
        listing = parse_listing(row, product_url)
        if not listing or listing.article_id in seen:
            continue
        seen.add(listing.article_id)
        if condition_ok(listing.condition, min_condition):
            listings.append(listing)

    return listings


def parse_listing(row: Any, product_url: str) -> Listing | None:
    article_id = (
        row.get("data-article-id")
        or row.get("data-id-article")
        or re.sub(r"^articleRow|^article-", "", row.get("id", ""))
    )
    if not article_id:
        nested = row.select_one("[data-article-id], [data-id-article]")
        if nested:
            article_id = nested.get("data-article-id") or nested.get("data-id-article")
    if not article_id:
        return None

    price = extract_price(row)
    if price is None:
        return None

    condition = extract_condition(row)
    seller = extract_seller(row)
    return Listing(
        article_id=str(article_id),
        condition=condition,
        listing_url=f"{product_url}#article-{article_id}",
        price=price,
        seller=seller,
    )


def extract_price(row: Any) -> float | None:
    price_element = row.select_one(
        ".price-container .font-weight-bold, .price-container, span.price, [data-price]"
    )
    if price_element:
        price = parse_price(
            price_element.get("data-price") or price_element.get_text(" ", strip=True)
        )
        if price is not None:
            return price

    for text in row.find_all(string=re.compile(r"\d+[.,]\d{2}\s*€")):
        price = parse_price(str(text))
        if price is not None:
            return price
    return None


def extract_condition(row: Any) -> str:
    for element in row.select("[title], [data-original-title], [aria-label], .condition"):
        text = " ".join(
            str(value)
            for value in [
                element.get("title"),
                element.get("data-original-title"),
                element.get("aria-label"),
                element.get_text(" ", strip=True),
            ]
            if value
        )
        condition = parse_condition(text)
        if condition:
            return condition

    return parse_condition(row.get_text(" ", strip=True)) or "EX"


def extract_seller(row: Any) -> str:
    seller = row.select_one("span.seller-name, a[href*='/Users/']")
    if seller:
        return seller.get_text(" ", strip=True)
    return "unknown"


def parse_price(text: str) -> float | None:
    cleaned = re.sub(r"[€$£\s]", "", text or "")
    if re.search(r"\d{1,3}\.\d{3},\d{2}", cleaned):
        cleaned = cleaned.replace(".", "").replace(",", ".")
    elif "," in cleaned and "." not in cleaned:
        cleaned = cleaned.replace(",", ".")
    elif "," in cleaned and "." in cleaned:
        cleaned = cleaned.replace(",", "")

    try:
        parsed = float(cleaned)
    except ValueError:
        return None
    return parsed if parsed > 0 else None


def parse_condition(text: str) -> str | None:
    normalized = text.strip().lower()
    labels = [
        ("near mint", "NM"),
        ("light played", "LP"),
        ("excellent", "EX"),
        ("played", "PL"),
        ("mint", "MT"),
        ("good", "GD"),
        ("poor", "PO"),
    ]
    for label, code in labels:
        if label in normalized:
            return code
    for code in CONDITION_ORDER:
        if re.search(rf"\b{code}\b", normalized, re.I):
            return code
    return None


def condition_ok(condition: str, min_condition: str | None) -> bool:
    if not min_condition:
        return True
    try:
        return CONDITION_ORDER.index(condition) <= CONDITION_ORDER.index(min_condition)
    except ValueError:
        return False


def strip_query_and_fragment(url: str) -> str:
    parsed = urlparse(url)
    return urlunparse(parsed._replace(query="", fragment=""))


def normalize_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def is_cloudflare_challenge(html: str) -> bool:
    sample = html[:4_000]
    return (
        "Just a moment" in sample
        or "challenges.cloudflare.com" in sample
        or "cf-chl" in sample
    )


def browser_headless() -> bool:
    return os.getenv("CARDMARKET_BROWSER_HEADLESS", "false").lower() in {
        "1",
        "true",
        "yes",
    }


def use_persistent_browser_profile() -> bool:
    return os.getenv("CARDMARKET_BROWSER_PERSISTENT", "true").lower() not in {
        "0",
        "false",
        "no",
    }


def browser_profile_dir() -> Path:
    configured = os.getenv("CARDMARKET_BROWSER_PROFILE_DIR")
    if configured:
        return Path(configured).expanduser()
    return Path(__file__).resolve().parent / ".cardmarket-profile"


def cloudflare_wait_seconds() -> int:
    try:
        value = int(os.getenv("CARDMARKET_CHALLENGE_WAIT_SECONDS", "120"))
    except ValueError:
        return 120
    return max(10, value)
