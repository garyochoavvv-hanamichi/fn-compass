#!/usr/bin/env python3
import asyncio, json, re, hashlib
from urllib.request import Request, urlopen
from datetime import datetime, timezone, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
from difflib import SequenceMatcher

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "tournaments.json"
LIMA = ZoneInfo("America/Lima")

MONTHS = "January February March April May June July August September October November December".split()
DATE_RE = re.compile(
    r"(" + "|".join(MONTHS) + r")\s+(\d{1,2}),\s+(\d{4})\s+"
    r"(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)",
    re.I,
)

SEED_PATHS = [
    "S39_RankedCupDuos",
    "S42_RankedCupSolo",
    "S36_RankedCupTrios",
    "S39_ReloadEliteSeriesFinal",
]

def old_data():
    try:
        return json.loads(DATA.read_text("utf-8"))
    except Exception:
        return {"events": []}

def clean(s):
    return re.sub(r"\s+", " ", s or "").strip()

def keyname(s):
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()

def fmt(text):
    t = (text or "").lower()
    if re.search(r"\btrio(s)?\b", t): return "TRIO"
    if re.search(r"\bduo(s)?\b", t): return "DUO"
    if re.search(r"\bsolo(s)?\b", t): return "SOLO"
    if re.search(r"\bsquad(s)?\b", t): return "SQUAD"
    return None

def platform(name):
    n = (name or "").lower()
    if "mobile" in n: return "MOBILE"
    if "console" in n or "playstation" in n or "xbox" in n: return "CONSOLE"
    return "MULTI"

def make_event(name, region, date_text, source_url):
    m = DATE_RE.search(date_text)
    if not m:
        return None
    month, day, year, start_s, end_s = m.groups()
    start = datetime.strptime(
        f"{month} {day} {year} {start_s.upper()}",
        "%B %d %Y %I:%M %p"
    ).replace(tzinfo=LIMA)
    end = datetime.strptime(
        f"{month} {day} {year} {end_s.upper()}",
        "%B %d %Y %I:%M %p"
    ).replace(tzinfo=LIMA)
    if end < start:
        end += timedelta(days=1)

    name = clean(re.sub(r"^\[(?:NAC|BR|NAW|NAE)\]\s*", "", name, flags=re.I))
    if not name:
        return None

    zero = bool(re.search(r"zero\s*build|\bzb\b", name, re.I))
    mode = "RELOAD" if "reload" in name.lower() else "BR"
    ident = hashlib.sha1(f"{region}|{name}|{start.isoformat()}".encode()).hexdigest()[:14]
    return {
        "id": ident,
        "name": name,
        "region": region,
        "format": None,
        "mode": mode,
        "zeroBuild": zero,
        "platform": platform(name),
        "start": start.isoformat(),
        "end": end.isoformat(),
        "sourceUrl": source_url,
        "mapUrl": "https://fortnite.gg/?map=reload" if mode == "RELOAD" else "https://fortnite.gg/",
    }

def parse_body(body_text, region, source_url):
    raw_lines = [clean(x) for x in (body_text or "").splitlines()]
    lines = [x for x in raw_lines if x]
    out = []

    for i, line in enumerate(lines):
        m = DATE_RE.search(line)
        if not m:
            continue

        prefix = clean(line[:m.start()])
        name = prefix
        if not name:
            for j in range(i - 1, max(-1, i - 5), -1):
                candidate = lines[j]
                if candidate in ("NAC", "BR", "NAE", "NAW", "EU", "OCE", "ASIA", "ME"):
                    continue
                if candidate.lower() in ("upcoming events", "schedule", "region", "date", "year", "month"):
                    continue
                if DATE_RE.search(candidate):
                    continue
                name = candidate
                break

        if not name:
            continue

        nearby_before = lines[max(0, i - 5):i + 1]
        region_markers = [x for x in nearby_before if x in ("NAC", "BR", "NAE", "NAW", "EU", "OCE", "ASIA", "ME")]
        if region_markers and region_markers[-1] != region:
            title_region = re.match(r"^\[(NAC|BR|NAE|NAW)\]", name, re.I)
            if not title_region or title_region.group(1).upper() != region:
                continue

        e = make_event(name, region, line[m.start():], source_url)
        if not e:
            continue

        context = " ".join(lines[i:i + 7])
        e["format"] = fmt(context) or fmt(name)
        if not e["format"]:
            continue

        cl = context.lower()
        if "reload" in cl:
            e["mode"] = "RELOAD"
            e["mapUrl"] = "https://fortnite.gg/?map=reload"
        if "zero build" in cl:
            e["zeroBuild"] = True

        out.append(e)

    ded = {}
    for e in out:
        ded[(keyname(e["name"]), e["region"], e["start"])] = e
    return list(ded.values())

def fetch_text_proxy(url):
    proxy = "https://r.jina.ai/" + url
    req = Request(proxy, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(req, timeout=35) as r:
        return r.read().decode("utf-8", "replace")

async def fetch_region(region):
    from playwright.async_api import async_playwright
    errors = []

    # First try a text proxy. This is much less likely to be blocked by
    # Fortnite's anti-bot page than a CI browser IP.
    for event_slug in SEED_PATHS:
        url = f"https://www.fortnite.com/competitive/events/{event_slug}/schedule?lang=en-US&region={region}"
        try:
            text = await asyncio.to_thread(fetch_text_proxy, url)
            events = parse_body(text, region, url)
            if events:
                return events
            errors.append(f"proxy {event_slug}: 0 parsed")
        except Exception as ex:
            errors.append(f"proxy {event_slug}: {type(ex).__name__}: {ex}")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(
            timezone_id="America/Lima",
            locale="en-US",
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129 Safari/537.36",
        )
        page = await ctx.new_page()

        for event_slug in SEED_PATHS:
            url = f"https://www.fortnite.com/competitive/events/{event_slug}/schedule?lang=en-US&region={region}"
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=90000)
                await page.wait_for_timeout(5000)
                title = (await page.title()).lower()
                body = await page.locator("body").inner_text(timeout=15000)
                body_l = body.lower()
                if "just a moment" in title or "checking your browser" in body_l:
                    raise RuntimeError("Cloudflare challenge")
                events = parse_body(body, region, url)
                if events:
                    await browser.close()
                    return events
                errors.append(f"{event_slug}: 0 parsed")
            except Exception as ex:
                errors.append(f"{event_slug}: {type(ex).__name__}: {ex}")

        await browser.close()
    raise RuntimeError(" | ".join(errors))

async def fetch_tracker_links(region):
    try:
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            ctx = await browser.new_context(
                locale="en-US",
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129 Safari/537.36",
            )
            page = await ctx.new_page()
            await page.goto(
                f"https://fortnitetracker.com/events?region={region}",
                wait_until="domcontentloaded",
                timeout=70000,
            )
            await page.wait_for_timeout(4000)
            if "just a moment" in (await page.title()).lower():
                raise RuntimeError("challenge")

            links = []
            anchors = page.locator('a[href*="/events/"]')
            for i in range(min(await anchors.count(), 400)):
                a = anchors.nth(i)
                try:
                    txt = clean(await a.inner_text(timeout=1000))
                    href = await a.get_attribute("href")
                    if txt and href and "/events/" in href:
                        if href.startswith("/"):
                            href = "https://fortnitetracker.com" + href
                        links.append((txt, href))
                except Exception:
                    pass
            await browser.close()
            return links
    except Exception:
        return []

def attach_tracker(events, tracker, previous):
    prev = {
        (keyname(e.get("name", "")), e.get("region")): e.get("trackerUrl")
        for e in previous if e.get("trackerUrl")
    }
    for e in events:
        best = (0.0, None)
        en = keyname(e["name"])
        for txt, url in tracker.get(e["region"], []):
            score = SequenceMatcher(None, en, keyname(txt)).ratio()
            if score > best[0]:
                best = (score, url)
        if best[0] >= 0.72:
            e["trackerUrl"] = best[1]
        elif prev.get((en, e["region"])):
            e["trackerUrl"] = prev[(en, e["region"])]
    return events

def previous_region_events(previous, region):
    threshold = datetime.now(timezone.utc) - timedelta(hours=12)
    kept = []
    for e in previous:
        if e.get("region") != region:
            continue
        try:
            end = datetime.fromisoformat(e.get("end", "").replace("Z", "+00:00"))
            if end.tzinfo is None:
                end = end.replace(tzinfo=timezone.utc)
            if end.astimezone(timezone.utc) >= threshold:
                kept.append(e)
        except Exception:
            kept.append(e)
    return kept

async def main():
    prev = old_data()
    previous = prev.get("events", [])
    events = []
    status = {}

    for region in ("NAC", "BR"):
        try:
            fresh = await fetch_region(region)
            status[region] = f"fresh:{len(fresh)}"
            events.extend(fresh)
        except Exception as ex:
            fallback = previous_region_events(previous, region)
            status[region] = f"fallback:{len(fallback)} ({ex})"
            events.extend(fallback)

    if not events:
        print("No region produced data; preserving last good calendar.")
        return 0

    tracker = {r: await fetch_tracker_links(r) for r in ("NAC", "BR")}
    events = attach_tracker(events, tracker, previous)

    ded = {}
    for e in events:
        ded[(keyname(e.get("name", "")), e.get("region"), e.get("start"))] = e
    events = sorted(ded.values(), key=lambda e: e.get("start", ""))

    payload = {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "Fortnite Competitive official schedule",
        "regionStatus": status,
        "events": events,
    }
    DATA.parent.mkdir(parents=True, exist_ok=True)
    DATA.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", "utf-8")
    print("Region status:", status)
    print(f"Wrote {len(events)} events total; NAC={sum(e.get('region')=='NAC' for e in events)}, BR={sum(e.get('region')=='BR' for e in events)}, Tracker linked={sum(bool(e.get('trackerUrl')) for e in events)}")
    return 0

if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
