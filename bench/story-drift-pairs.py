# The replays of bench/story-drift.py scored on the cards of the search judged by hand
# (bench/data/story-cards/unique.json + judged.json, unique-v.json + judged-v.json): a card judged one
# news (Y) should stay in one story, a card judged as different news (N) should not.
# Only the news that have a story in the database (the ones the replay groups) are counted.
# python bench/story-drift-pairs.py
import glob, json, re
import numpy as np
from collections import defaultdict

D = 'bench/data/story-drift'
C = 'bench/data/story-cards'
META = json.load(open(f'{D}/meta.json', encoding='utf-8'))
key = {}
for i, m in enumerate(META): key.setdefault((m['title'][:110].strip(), m['medium']), i)

def members(label):
    t, med = re.match(r'^(.*?)\s+\[([^,\]]+)(?:, no story)?\]$', label).groups()
    return key.get((t.strip(), med))

items = []
for u, j in (('unique.json', 'judged.json'), ('unique-v.json', 'judged-v.json')):
    unique = json.load(open(f'{C}/{u}', encoding='utf-8'))
    judged = json.load(open(f'{C}/{j}', encoding='utf-8'))
    judged = judged.get('judged', judged)
    for n, x in enumerate(unique):
        v = x.get('verdict') or judged.get(str(n))
        if v not in ('Y', 'N'): continue
        parts = [[members(l) for l in p] for p in x['parts']]
        parts = [[i for i in p if i is not None] for p in parts]
        parts = [p for p in parts if p]
        if len(parts) >= 2: items.append((v, parts))
seen = set(); unique_items = []
for v, parts in items:
    k = tuple(sorted(tuple(sorted(p)) for p in parts))
    if k not in seen: seen.add(k); unique_items.append((v, parts))
print(f'{len(unique_items)} judged cards found in the replay ({sum(v == "Y" for v, _ in unique_items)} one news, {sum(v == "N" for v, _ in unique_items)} different news)')

def score(story):
    ok = defaultdict(int)
    for v, parts in unique_items:
        together = len({story[i] for p in parts for i in p}) == 1
        ok[v] += together if v == 'Y' else not together
    return ok

ref = np.array([m['story'] for m in META])
rows = [('database', ref)] + [(f[len(D) + 8:-4].replace('_', ' '), np.load(f)) for f in sorted(glob.glob(f'{D}/replay-*.npy'))]
ny = sum(v == 'Y' for v, _ in unique_items); nn = len(unique_items) - ny
for name, story in rows:
    s = score(story)
    print(f'  {name:<28} one news kept in one story {s["Y"]}/{ny}, different news kept apart {s["N"]}/{nn}')
