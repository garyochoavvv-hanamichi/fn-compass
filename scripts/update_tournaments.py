#!/usr/bin/env python3
import asyncio, json, re, hashlib
from urllib.request import Request, urlopen
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse
from datetime import datetime, timezone, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
from difflib import SequenceMatcher

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "tournaments.json"
RANKINGS = ROOT / "data" / "rankings.json"
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

def markdown_link(line):
    """Return (visible title, href) for a markdown link produced by the text proxy."""
    m = re.match(r"^\[(.*)\]\((https?://[^)]+)\)\s*$", clean(line))
    return (clean(m.group(1)), m.group(2)) if m else (clean(line), None)

def explicit_region(title, href=""):
    # Proxy titles can contain [NAC]/[NAW]. BR is often only present in the round URL.
    m = re.match(r"^\[(NAC|BR|NAW|NAE)\]\s*", title or "", re.I)
    if m:
        return m.group(1).upper()
    u = (href or "").upper()
    m = re.search(r"(?:_|-)(NAC|BR|NAW|NAE)(?:\b|_|&|$)", u)
    return m.group(1).upper() if m else None

def strip_region(title):
    return clean(re.sub(r"^\[(?:NAC|BR|NAW|NAE)\]\s*", "", title or "", flags=re.I))

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

def make_event(name, region, date_text, source_url, event_url=None):
    m = DATE_RE.search(date_text)
    if not m:
        return None
    month, day, year, start_s, end_s = m.groups()

    # The proxy renders Fortnite schedule times in UTC. Convert them to Peru time.
    start_utc = datetime.strptime(
        f"{month} {day} {year} {start_s.upper()}",
        "%B %d %Y %I:%M %p"
    ).replace(tzinfo=timezone.utc)
    end_utc = datetime.strptime(
        f"{month} {day} {year} {end_s.upper()}",
        "%B %d %Y %I:%M %p"
    ).replace(tzinfo=timezone.utc)
    if end_utc < start_utc:
        end_utc += timedelta(days=1)
    start = start_utc.astimezone(LIMA)
    end = end_utc.astimezone(LIMA)

    name = strip_region(name)
    if not name:
        return None

    signal = f"{name} {event_url or ''}"
    zero = bool(re.search(r"zero\s*build|(?:_|\b)zb(?:_|\b)|soloszb", signal, re.I))
    mode = "RELOAD" if "reload" in signal.lower() else "BR"
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
        "sourceUrl": event_url or source_url,
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

        # Find the event title immediately before the date. Jina represents it
        # as [title](Fortnite event URL), sometimes with [NAC]/[NAW] in title.
        name_line = clean(line[:m.start()])
        title = ""
        event_url = None
        if name_line:
            title, event_url = markdown_link(name_line)
        else:
            for j in range(i - 1, max(-1, i - 6), -1):
                candidate = lines[j]
                if DATE_RE.search(candidate):
                    break
                cand_title, cand_url = markdown_link(candidate)
                if cand_url and "/competitive/events/" in cand_url:
                    title, event_url = cand_title, cand_url
                    break
                if candidate in ("NAC", "BR", "NAE", "NAW", "EU", "OCE", "ASIA", "ME"):
                    continue
                if candidate.lower() in ("upcoming events", "schedule", "region", "date", "year", "month"):
                    continue
                if not title:
                    title = cand_title

        if not title:
            continue

        found_region = explicit_region(title, event_url or "")
        if found_region:
            # NAC and NAW are separate in Fortnite. Never relabel NAW as NAC.
            if found_region != region:
                continue

        # Build only this event's local block. Stop before the next event link/date
        # so format/mode labels never leak from the following tournament.
        block = [strip_region(markdown_link(title)[0]), line[m.start():]]
        for k in range(i + 1, min(len(lines), i + 10)):
            nxt = lines[k]
            if DATE_RE.search(nxt):
                break
            nt, nu = markdown_link(nxt)
            if nu and "/competitive/events/" in nu:
                break
            block.append(nt)
        context = " ".join(block)

        e = make_event(title, region, line[m.start():], source_url, event_url)
        if not e:
            continue

        e["format"] = fmt(context) or fmt(e["name"])
        signal = f"{e['name']} {event_url or ''}".lower()

        # Stable fallbacks for event families whose visible card omits team size.
        if not e["format"]:
            if "cyperprankscup_mobile" in signal or "mobilevictorycup" in signal:
                e["format"] = "SOLO"
            elif "cyperprankscup" in signal:
                e["format"] = "TRIO"
            elif "rankedcupsoloreload" in signal or "consolevcc_solos" in signal:
                e["format"] = "SOLO"

        if not e["format"]:
            continue

        # Mode and Zero Build come only from this event's title/URL, never from
        # neighbouring cards.
        e["mode"] = "RELOAD" if "reload" in signal else "BR"
        e["zeroBuild"] = bool(re.search(r"zero\s*build|(?:_|\b)zb(?:_|\b)|soloszb", signal, re.I))
        e["mapUrl"] = "https://fortnite.gg/?map=reload" if e["mode"] == "RELOAD" else "https://fortnite.gg/"

        out.append(e)

    ded = {}
    for e in out:
        ded[(keyname(e["name"]), e["region"], e["start"])] = e
    return list(ded.values())

def fetch_text_proxy(url):
    proxy = "https://r.jina.ai/" + url
    req = Request(proxy, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(req, timeout=22) as r:
        return r.read().decode("utf-8", "replace")

def fetch_text_proxy_fresh(url):
    """Force Jina Reader to bypass cache and wait for Tracker's JS table."""
    proxy = "https://r.jina.ai/" + url
    req = Request(proxy, headers={
        "User-Agent": "Mozilla/5.0",
        "X-No-Cache": "true",
        "X-Cache-Tolerance": "0",
        "X-Engine": "browser",
        "X-Respond-With": "markdown",
    })
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

def event_round(event):
    try:
        q = parse_qs(urlparse(event.get("sourceUrl", "")).query)
        vals = q.get("round") or q.get("window")
        return vals[0] if vals else None
    except Exception:
        return None

def canonical_tracker_url(event):
    """Build the exact Tracker event page from Fortnite's official event slug."""
    try:
        path = urlparse(event.get("sourceUrl", "")).path.rstrip("/")
        slug = path.split("/competitive/events/", 1)[1].split("/", 1)[0]
    except Exception:
        return None

    name = (event.get("name") or "").lower()
    window = event_round(event) or ""
    tracker_slug = slug

    # Tracker uses a few stable aliases that differ from Epic's schedule slug.
    if slug == "S42_MobileVictoryCup" and "mini venture" in name:
        tracker_slug = "S42_MobileVictoryCup_ReloadminiV"
    elif slug == "S42_SoloVictoryCupBR":
        tracker_slug = "S42_SoloVictoryCup"
    elif slug == "S42_ChampionFocusFNCSCup" and "_ZB_" in f"_{window}_":
        tracker_slug = "S42_ChampionFocusFNCSCup_ZB"

    region = event.get("region")
    if not tracker_slug or not region:
        return None
    return f"https://fortnitetracker.com/events/epicgames_{tracker_slug}_{region}"

def attach_tracker(events, tracker, previous):
    prev = {
        (keyname(e.get("name", "")), e.get("region")): e.get("trackerUrl")
        for e in previous if e.get("trackerUrl")
    }
    for e in events:
        en = keyname(e["name"])

        # 1) Exact URL derived from Epic's event slug. This covers both NAC and
        # BR even when Tracker's events index is blocked by Cloudflare.
        exact = canonical_tracker_url(e)
        if exact:
            e["trackerUrl"] = exact
            continue

        # 2) Previously verified URL.
        if prev.get((en, e["region"])):
            e["trackerUrl"] = prev[(en, e["region"])]
            continue

        # 3) Fuzzy discovery only as a final fallback.
        best = (0.0, None)
        for txt, url in tracker.get(e["region"], []):
            score = SequenceMatcher(None, en, keyname(txt)).ratio()
            if score > best[0]:
                best = (score, url)
        if best[0] >= 0.72:
            e["trackerUrl"] = best[1]
    return events


def old_rankings():
    try:
        return json.loads(RANKINGS.read_text("utf-8"))
    except Exception:
        return {"events": {}}

def tracker_window(event):
    return event_round(event)

def tracker_page_url(event, page_num):
    base = event.get("trackerUrl")
    if not base:
        return None
    p = urlparse(base)
    q = parse_qs(p.query)
    if page_num > 0:
        q["page"] = [str(page_num)]
    else:
        q.pop("page", None)
    window = tracker_window(event)
    if window:
        q["window"] = [window]
    flat = []
    for k, vals in q.items():
        for v in vals:
            flat.append((k, v))
    return urlunparse((p.scheme, p.netloc, p.path, p.params, urlencode(flat), p.fragment))

def md_cell(text):
    text = re.sub(r"!\[[^\]]*\]\([^)]+\)", "", text or "")
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"\{\{.*?\}\}", "", text)
    return clean(text).strip(" |")

def parse_int(value):
    m = re.search(r"-?\d[\d,]*", value or "")
    if not m:
        return None
    try:
        return int(m.group(0).replace(",", ""))
    except Exception:
        return None

def parse_tracker_markdown(text):
    lines = [x.rstrip() for x in (text or "").splitlines()]
    rows = []
    header = None
    header_idx = -1

    # Find a rendered leaderboard markdown table. Tracker sometimes includes
    # Angular template placeholders earlier on the page, so prefer headers that
    # contain Points plus Rank and a real player/team column.
    for i, line in enumerate(lines):
        if "|" not in line:
            continue
        cells = [md_cell(c) for c in line.strip().strip("|").split("|")]
        low = [c.lower() for c in cells]
        if "rank" in low and any("point" in c for c in low) and any(
            ("player" in c or "team" in c) for c in low
        ):
            header = cells
            header_idx = i
            # Keep searching; the last leaderboard header is usually the actual
            # event leaderboard rather than an explanatory template.
    if not header:
        return [], {}

    low = [c.lower() for c in header]
    rank_i = next((i for i,c in enumerate(low) if c == "rank"), 0)
    points_i = next((i for i,c in enumerate(low) if "point" in c), None)
    matches_i = next((i for i,c in enumerate(low) if "match" in c), None)
    player_i = next((i for i,c in enumerate(low) if "player" in c or "team" in c), 1)

    # Skip the markdown separator row.
    for line in lines[header_idx + 1:]:
        if "|" not in line:
            if rows:
                break
            continue
        raw = [md_cell(c) for c in line.strip().strip("|").split("|")]
        if len(raw) < 3:
            continue
        if all(re.fullmatch(r":?-{2,}:?", c or "") for c in raw):
            continue
        if rank_i >= len(raw) or points_i is None or points_i >= len(raw):
            continue
        rank = parse_int(raw[rank_i])
        points = parse_int(raw[points_i])
        if rank is None or points is None:
            # End once real rows have started and a non-row is reached.
            if rows:
                break
            continue
        team = raw[player_i] if player_i < len(raw) else "Unknown"
        matches = parse_int(raw[matches_i]) if matches_i is not None and matches_i < len(raw) else None
        if not team or "unknown" == team.lower():
            team = "Jugador / equipo"
        rows.append({
            "rank": rank,
            "team": team,
            "points": points,
            "matches": matches,
        })

    meta = {}
    m = re.search(r"([\d,]+)\s+Participating\s+(?:Players|Teams)", text or "", re.I)
    if m:
        meta["participants"] = int(m.group(1).replace(",", ""))
    m = re.search(r"Last Updated\s+([^\n.]+)", text or "", re.I)
    if m:
        meta["trackerUpdated"] = clean(m.group(1))

    # Tracker exposes live/current reward thresholds even when it has not yet
    # published the full leaderboard rows.
    cuts = []
    for cm in re.finditer(r"Top\s*#?([\d,]+)\s+([\d,]+)\s*Pts?\.", text or "", re.I):
        rank = int(cm.group(1).replace(",", ""))
        points = int(cm.group(2).replace(",", ""))
        if not any(x["rank"] == rank for x in cuts):
            cuts.append({"rank": rank, "points": points})
    if cuts:
        meta["cutoffs"] = sorted(cuts, key=lambda x: x["rank"])
    return rows, meta

def ranking_relevant(event, now):
    try:
        start = datetime.fromisoformat(event.get("start", "").replace("Z", "+00:00")).astimezone(timezone.utc)
        end = datetime.fromisoformat(event.get("end", "").replace("Z", "+00:00")).astimezone(timezone.utc)
    except Exception:
        return False
    # Fetch shortly before start, while live, and for a few hours afterward.
    return start - timedelta(minutes=45) <= now <= end + timedelta(hours=4)

async def parse_tracker_dom(page):
    meta = {}
    body_text = await page.locator("body").inner_text(timeout=15000)
    m = re.search(r"([\d,]+)\s+Participating\s+(?:Players|Teams)", body_text or "", re.I)
    if m:
        meta["participants"] = int(m.group(1).replace(",", ""))
    m = re.search(r"Last Updated\s+([^\n.]+)", body_text or "", re.I)
    if m:
        meta["trackerUpdated"] = clean(m.group(1))
    cuts = []
    for cm in re.finditer(r"Top\s*#?([\d,]+)\s+([\d,]+)\s*Pts?\.", body_text or "", re.I):
        rank = int(cm.group(1).replace(",", ""))
        points = int(cm.group(2).replace(",", ""))
        if not any(x["rank"] == rank for x in cuts):
            cuts.append({"rank": rank, "points": points})
    if cuts:
        meta["cutoffs"] = sorted(cuts, key=lambda x: x["rank"])

    tables = page.locator("table")
    for ti in range(await tables.count()):
        table = tables.nth(ti)
        headers = [clean(x) for x in await table.locator("thead th").all_inner_texts()]
        if not headers:
            # Some responsive tables do not expose a thead; inspect first row.
            first = table.locator("tr").first
            headers = [clean(x) for x in await first.locator("th").all_inner_texts()]
        low = [h.lower() for h in headers]
        if not headers or "rank" not in low or not any("point" in h for h in low):
            continue
        if not any(("player" in h or "team" in h) for h in low):
            continue

        rank_i = next((i for i,h in enumerate(low) if h == "rank"), 0)
        points_i = next((i for i,h in enumerate(low) if "point" in h), None)
        matches_i = next((i for i,h in enumerate(low) if "match" in h), None)
        player_i = next((i for i,h in enumerate(low) if "player" in h or "team" in h), 1)
        if points_i is None:
            continue

        rows = []
        trs = table.locator("tbody tr")
        if await trs.count() == 0:
            trs = table.locator("tr")
        for ri in range(await trs.count()):
            cells = [clean(x) for x in await trs.nth(ri).locator("td").all_inner_texts()]
            if not cells:
                continue
            if rank_i >= len(cells) or points_i >= len(cells):
                continue
            rank = parse_int(cells[rank_i])
            points = parse_int(cells[points_i])
            if rank is None or points is None:
                continue
            team = cells[player_i] if player_i < len(cells) else "Jugador / equipo"
            team = re.sub(r"\bImage:\s*", "", team, flags=re.I)
            team = clean(team) or "Jugador / equipo"
            matches = parse_int(cells[matches_i]) if matches_i is not None and matches_i < len(cells) else None
            rows.append({"rank": rank, "team": team, "points": points, "matches": matches})

        if rows:
            return rows, meta
    return [], meta

async def fetch_event_ranking_fast(event, old_entry=None):
    if not event.get("trackerUrl"):
        return None

    url = tracker_page_url(event, 0)
    rows = []
    meta = {}
    errors = []

    # One rendered request per event. Repeated multi-page requests caused 429s
    # when several NAC/BR cups were live at once.
    try:
        text = await asyncio.to_thread(fetch_text_proxy_fresh, url)
        rows, meta = parse_tracker_markdown(text)
    except Exception as ex:
        errors.append(f"fresh: {type(ex).__name__}: {ex}")

    # Never erase a previously captured table because the source temporarily
    # rate-limited us or returned an incomplete render.
    if not rows and old_entry and old_entry.get("rows"):
        kept = dict(old_entry)
        kept["status"] = "stale"
        kept["lastError"] = " | ".join(errors[-3:]) or "source returned no rows"
        if meta.get("cutoffs"):
            kept["cutoffs"] = meta["cutoffs"]
        return kept

    return {
        "eventId": event.get("id"),
        "name": event.get("name"),
        "region": event.get("region"),
        "trackerUrl": event.get("trackerUrl"),
        "window": tracker_window(event),
        "eventStart": event.get("start"),
        "eventEnd": event.get("end"),
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "status": "ok" if rows else "empty",
        "participants": meta.get("participants"),
        "trackerUpdated": meta.get("trackerUpdated"),
        "cutoffs": meta.get("cutoffs", []),
        "rows": rows,
        "lastError": " | ".join(errors[-3:]) if errors else None,
    }

async def update_rankings(events):
    previous = old_rankings()
    prev_events = previous.get("events", {})
    now = datetime.now(timezone.utc)
    out = dict(prev_events)
    relevant = [e for e in events if e.get("trackerUrl") and ranking_relevant(e, now)]

    # Keep requests modest to avoid Tracker/Jina rate limits while still
    # completing comfortably inside the five-minute workflow cadence.
    sem = asyncio.Semaphore(2)

    async def one(index, e):
        async with sem:
            # Small stagger avoids bursts from the shared Actions IP.
            await asyncio.sleep((index % 2) * 0.8)
            old = prev_events.get(e.get("id"))
            result = await fetch_event_ranking_fast(e, old)
            return e.get("id"), result

    results = await asyncio.gather(
        *(one(i, e) for i, e in enumerate(relevant)),
        return_exceptions=True,
    )
    for result in results:
        if isinstance(result, Exception):
            print("Ranking task error:", result)
            continue
        event_id, entry = result
        if event_id and entry:
            out[event_id] = entry

    # Keep recent finished rounds so a selected tournament never loses its
    # table just because Epic removed it from the upcoming schedule.
    valid_ids = {e.get("id") for e in events}
    history_cutoff = now - timedelta(hours=72)
    kept = {}
    for k, v in out.items():
        if k in valid_ids:
            kept[k] = v
            continue
        stamp = v.get("updatedAt") or v.get("eventEnd")
        try:
            dt = datetime.fromisoformat((stamp or "").replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            if dt.astimezone(timezone.utc) >= history_cutoff:
                kept[k] = v
        except Exception:
            if v.get("rows"):
                kept[k] = v
    out = kept

    payload = {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "Fortnite Tracker public event leaderboards",
        "events": out,
    }
    RANKINGS.parent.mkdir(parents=True, exist_ok=True)
    RANKINGS.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", "utf-8")

    row_count = sum(len(v.get("rows", [])) for v in out.values())
    print(f"Rankings: relevant={len(relevant)}, events_saved={len(out)}, rows={row_count}")
    for e in relevant:
        v = out.get(e.get("id"), {})
        print(f"  {e.get('region')} | {e.get('name')} | {v.get('status')} | rows={len(v.get('rows', []))} | {v.get('lastError') or ''}")


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
            recent = previous_region_events(previous, region)
            known = {e.get("id") for e in fresh}
            merged = fresh + [e for e in recent if e.get("id") not in known]
            status[region] = f"fresh:{len(fresh)}+recent:{len(merged)-len(fresh)}"
            events.extend(merged)
        except Exception as ex:
            fallback = previous_region_events(previous, region)
            status[region] = f"fallback:{len(fallback)} ({ex})"
            events.extend(fallback)

    if not events:
        print("No region produced data; preserving last good calendar.")
        return 0

    # Exact Tracker URLs are generated from Epic event IDs. This avoids a
    # fragile Cloudflare-protected discovery step and works for both NAC + BR.
    events = attach_tracker(events, {"NAC": [], "BR": []}, previous)

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
    await update_rankings(events)
    return 0

if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
