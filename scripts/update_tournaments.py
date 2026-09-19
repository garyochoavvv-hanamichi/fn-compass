#!/usr/bin/env python3
import asyncio, json, re, hashlib
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
from difflib import SequenceMatcher

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'data'/'tournaments.json'
LIMA=ZoneInfo('America/Lima')
MONTHS='January February March April May June July August September October November December'.split()
DATE_RE=re.compile(r'('+'|'.join(MONTHS)+r')\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)',re.I)
SEEDS={
 'NAC':'https://www.fortnite.com/competitive/events/S42_RankedCupSolo/schedule?region=NAC',
 'BR':'https://www.fortnite.com/competitive/events/S42_RankedCupSolo/schedule?region=BR'
}

def old_data():
    try:return json.loads(DATA.read_text('utf-8'))
    except:return {'events':[]}

def clean(s):return re.sub(r'\s+',' ',s or '').strip()
def keyname(s):return re.sub(r'[^a-z0-9]+',' ',s.lower()).strip()
def platform(name):
    n=name.lower()
    if 'mobile' in n:return 'MOBILE'
    if 'console' in n or 'playstation' in n or 'xbox' in n:return 'CONSOLE'
    return 'MULTI'
def fmt(text):
    t=text.lower()
    if 'trio' in t:return 'TRIO'
    if 'duo' in t:return 'DUO'
    if 'solo' in t:return 'SOLO'
    if 'squad' in t:return 'SQUAD'
    return None

def parse_card(text, href, region):
    text=clean(text)
    m=DATE_RE.search(text)
    team=fmt(text)
    if not m or not team:return None
    name=clean(text[:m.start()])
    name=re.sub(r'^(NAC|BR|NAW|NAE)\s+(Live\s+)?','',name,flags=re.I)
    if not name:return None
    month,day,year,start_s,end_s=m.groups()
    start=datetime.strptime(f'{month} {day} {year} {start_s.upper()}', '%B %d %Y %I:%M %p').replace(tzinfo=LIMA)
    end=datetime.strptime(f'{month} {day} {year} {end_s.upper()}', '%B %d %Y %I:%M %p').replace(tzinfo=LIMA)
    if end<start:
        from datetime import timedelta
        end+=timedelta(days=1)
    zero=bool(re.search(r'zero\s*build|\bzb\b',name,re.I))
    mode='RELOAD' if 'reload' in name.lower() else 'BR'
    ident=hashlib.sha1(f'{region}|{name}|{start.isoformat()}'.encode()).hexdigest()[:14]
    return {'id':ident,'name':name,'region':region,'format':team,'mode':mode,'zeroBuild':zero,'platform':platform(name),'start':start.isoformat(),'end':end.isoformat(),'sourceUrl':href,'mapUrl':'https://fortnite.gg/?map=reload' if mode=='RELOAD' else 'https://fortnite.gg/'}

async def fetch_official(region):
    from playwright.async_api import async_playwright
    out=[]
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True)
        ctx=await browser.new_context(timezone_id='America/Lima',locale='en-US',user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129 Safari/537.36')
        page=await ctx.new_page()
        await page.goto(SEEDS[region],wait_until='domcontentloaded',timeout=90000)
        await page.wait_for_timeout(4500)
        title=(await page.title()).lower()
        body=(await page.locator('body').inner_text()).lower()
        if 'just a moment' in title or 'checking your browser' in body: raise RuntimeError('Cloudflare challenge')
        anchors=page.locator('a[href*="/competitive/events/"]')
        for i in range(min(await anchors.count(),400)):
            a=anchors.nth(i)
            try:
                text=await a.inner_text(timeout=1500); href=await a.get_attribute('href') or SEEDS[region]
                if href.startswith('/'): href='https://www.fortnite.com'+href
                e=parse_card(text,href,region)
                if e: out.append(e)
            except: pass
        await browser.close()
    ded={}
    for e in out: ded[(keyname(e['name']),e['region'],e['start'])]=e
    return list(ded.values())

async def fetch_tracker_links(region):
    try:
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            browser=await p.chromium.launch(headless=True)
            ctx=await browser.new_context(locale='en-US',user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129 Safari/537.36')
            page=await ctx.new_page(); await page.goto(f'https://fortnitetracker.com/events?region={region}',wait_until='domcontentloaded',timeout=70000); await page.wait_for_timeout(4000)
            if 'just a moment' in (await page.title()).lower(): raise RuntimeError('challenge')
            links=[]; a=page.locator('a[href*="/events/"]')
            for i in range(min(await a.count(),350)):
                x=a.nth(i)
                try:
                    txt=clean(await x.inner_text(timeout=1000)); href=await x.get_attribute('href')
                    if txt and href and '/events/' in href:
                        if href.startswith('/'):href='https://fortnitetracker.com'+href
                        links.append((txt,href))
                except:pass
            await browser.close(); return links
    except:return []

def attach_tracker(events,tracker,previous):
    prev={(keyname(e.get('name','')),e.get('region')):e.get('trackerUrl') for e in previous if e.get('trackerUrl')}
    for e in events:
        best=(0,None)
        en=keyname(e['name'])
        for txt,url in tracker.get(e['region'],[]):
            score=SequenceMatcher(None,en,keyname(txt)).ratio()
            if score>best[0]:best=(score,url)
        if best[0]>=0.72:e['trackerUrl']=best[1]
        elif prev.get((en,e['region'])):e['trackerUrl']=prev[(en,e['region'])]
    return events

async def main():
    prev=old_data(); previous=prev.get('events',[])
    events=[]; failures=[]
    for region in ('NAC','BR'):
        try: events.extend(await fetch_official(region))
        except Exception as ex: failures.append(f'{region}: {ex}')
    if not events:
        print('Official fetch failed; preserving last good calendar:', '; '.join(failures)); return 0
    tracker={r:await fetch_tracker_links(r) for r in ('NAC','BR')}
    events=attach_tracker(events,tracker,previous)
    events.sort(key=lambda e:e.get('start',''))
    payload={'updatedAt':datetime.now(timezone.utc).isoformat(),'source':'Fortnite Competitive official calendar','events':events}
    DATA.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n','utf-8')
    print(f'Wrote {len(events)} events. Tracker linked: {sum(bool(e.get("trackerUrl")) for e in events)}')
    return 0

if __name__=='__main__': raise SystemExit(asyncio.run(main()))
