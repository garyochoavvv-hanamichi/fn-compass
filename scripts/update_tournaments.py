import importlib.util
from pathlib import Path
p=Path(__file__).resolve().parents[1]/'scripts'/'update_tournaments.py'
s=importlib.util.spec_from_file_location('upd',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)

def test_trio():
    e=m.parse_card('NAC Override Series: Cyberpunk: Edgerunners Cup Battle Royale September 19, 2026 6:00 PM - 9:00 PM Battle Royale Trios','https://www.fortnite.com/x','NAC')
    assert e and e['format']=='TRIO' and e['region']=='NAC' and e['start'].startswith('2026-09-19T18:00:00')

def test_reload():
    e=m.parse_card('BR Solo Reload Ranked Cup (Zero Build) September 19, 2026 4:00 PM - 7:00 PM Battle Royale Solos','https://www.fortnite.com/x','BR')
    assert e and e['format']=='SOLO' and e['mode']=='RELOAD' and e['zeroBuild'] is True
