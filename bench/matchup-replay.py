# The decisions of assign_stories (db/add_briefing.sql) for the English news of the last 36 hours that
# name a matchup, taken again against the stories of the database, as today and with the matchup rule:
# a story whose members naming a match name mostly another one ("Spain vs Croatia" for "Czechia vs
# England") is not a candidate.
# python bench/matchup-replay.py   (after bench/matchup-export.mjs)  -> bench/data/matchups/replay.txt
import json, re, sys, time, unicodedata, random
import numpy as np
from collections import defaultdict
from scipy.sparse import csr_matrix

D = 'bench/data/matchups'
META = json.load(open(f'{D}/meta.json', encoding='utf-8'))
N = len(META)
TITLE = np.fromfile(f'{D}/title_dense.f32', dtype=np.float32).reshape(N, 1024)
TEXT = np.fromfile(f'{D}/text_dense.f32', dtype=np.float32).reshape(N, 1024)
r, cidx, v = [], [], []
for i, row in enumerate(json.load(open(f'{D}/title_sparse.json', encoding='utf-8'))):
    for k, x in row.items(): r.append(i); cidx.append(int(k)); v.append(x)
SPARSE = csr_matrix((v, (r, cidx)), shape=(N, 250003), dtype=np.float32)

THRESHOLD, SPARSE_WEIGHT, MARGIN, TEXT_THRESHOLD, IDLE_DECAY, GRACE = 0.70, 1.0, 0.5, 0.6, 0.003, 6
RUN, H = 3 * 60, 3600

# --- the matchup of a title, as bench/matchup.mjs
# the first "vs" of the title, opening the title or a part of it (after ":", "|", a spaced dash, a
# bracket): at most 4 words before it, so "Spain vs Croatia Prediction", "Prediction: Croatia vs
# England", "How to watch Belgium vs Turkey", not "Browns Fans Turnaround in Win vs. Steelers"
SEPARATOR = re.compile(r'\s(?:vs\.?|v\.?|versus)\s+(\S+)', re.I)
PART = re.compile(r'[:|(\[]|\s[-–—]\s')
NOT_A_TEAM = {'tbd', 'tba'}
def fold(t): return ''.join(ch for ch in unicodedata.normalize('NFKD', t) if not unicodedata.combining(ch)).lower()
def is_name(w): return w[0].isupper() or unicodedata.category(w[0]) == 'Lo'
def names(t):
    """the words written with a capital, as title_names: not "canal" for Canada, "partido" for Paraguay"""
    plain = ''.join(ch for ch in unicodedata.normalize('NFKD', t) if not unicodedata.combining(ch))
    return [w.lower() for w in re.split(r'[\W_]+', plain) if len(w) >= 3 and is_name(w)]
def side(word):
    clean = re.split(r"['’]", re.sub(r'^[\W_]+|[\W_]+$', '', word))[0]
    w = names(clean.split('-')[-1])
    return w[0][:3] if w and w[0] not in NOT_A_TEAM else None
def matchup(title):
    m = SEPARATOR.search(title)
    if not m: return None
    before = PART.split(title[:m.start()])[-1].split()
    if not before or len(before) > 4: return None
    a, b = side(before[-1]), side(m.group(1))
    return (a, b, names(title)) if a and b and a != b else None
def appears(team, ws): return any(w.startswith(team) or team.startswith(w) for w in ws)
def different(m, n):
    """each names a team the other title lacks, and they share a team or neither holds a team of the other"""
    miss_m = any(not appears(t, n[2]) for t in m[:2]); miss_n = any(not appears(t, m[2]) for t in n[:2])
    if not (miss_m and miss_n): return False
    shared = bool({m[0], m[1]} & {n[0], n[1]})
    cross = any(appears(t, n[2]) for t in m[:2]) or any(appears(t, m[2]) for t in n[:2])
    return shared or not cross

MATCHUP = [matchup(m['title']) for m in META]
HAS = np.array([x is not None for x in MATCHUP])
print(f'{N} news, {HAS.sum()} with a matchup')

at = np.array([m['at'] for m in META]); created = np.array([m['created'] for m in META])
medium = [m['medium'] for m in META]
codes = lambda values: np.unique(np.array(values, dtype=object).astype(str), return_inverse=True)[1]
MEDIUM = codes([m if m is not None else '(none)' for m in medium])
LINK = codes([m['link'] for m in META]); TITLE_CODE = codes([m['title'] for m in META])
figures = [tuple(m['figures']) for m in META]
FIG = codes([','.join(map(str, f)) for f in figures])
NO_FIG = FIG[[k for k, f in enumerate(figures) if not f][0]]

DB = np.array([m['story'] for m in META])
order = np.argsort(created, kind='stable')
CR = created[order]; T = np.ascontiguousarray(TITLE[order]); X = np.ascontiguousarray(TEXT[order]); S = SPARSE[order].tocsr()
POS = np.empty(N, int); POS[order] = np.arange(N)

def decide(i, rule):
    """the story news i joins among the stories of the database, members saved before it and published in
    the 48 hours before it (as the run that grouped it saw them), as today or with the matchup rule"""
    k = POS[i]
    rows = order[:k]
    win = at[rows] >= at[i] - 48 * H
    st = DB[rows]
    again = win & (MEDIUM[rows] == MEDIUM[i]) & ((LINK[rows] == LINK[i]) | (TITLE_CODE[rows] == TITLE_CODE[i]))
    if again.any(): return st[np.argmax(again)], 'again'
    keep = win
    # with the rule: the members of the window naming another match, and the ones naming this one
    other = np.zeros(len(rows), bool); this = np.zeros(len(rows), bool)
    if rule:
        for j in np.where(win & HAS[rows])[0]:
            if different(MATCHUP[i], MATCHUP[rows[j]]): other[j] = True
            else: this[j] = True
    if not keep.any(): return -1, 'none'
    sim = (T[:k] @ T[k] + SPARSE_WEIGHT * (S[:k] @ S[k].T).toarray().ravel())[keep]
    text = (X[:k] @ X[k])[keep]
    s = st[keep]; rk = rows[keep]
    same = MEDIUM[rk] == MEDIUM[i]
    other_fig = (FIG[rk] != NO_FIG) & (FIG[i] != NO_FIG) & (FIG[rk] != FIG[i])
    ids, s = np.unique(s, return_inverse=True); n = len(ids)
    cnt = np.bincount(s, minlength=n); oth = np.bincount(s, weights=~same, minlength=n)
    sim_all = np.bincount(s, weights=sim, minlength=n); sim_oth = np.bincount(s, weights=sim * ~same, minlength=n)
    text_oth = np.bincount(s, weights=text * ~same, minlength=n)
    fig_any = np.bincount(s, weights=other_fig, minlength=n) > 0
    newest = np.full(n, -np.inf); np.maximum.at(newest, s, at[rk])
    with np.errstate(invalid='ignore', divide='ignore'):
        score = np.where(oth > 0, np.where(text_oth / oth >= TEXT_THRESHOLD, sim_oth / oth, -9),
                         np.where(~fig_any, sim_all / cnt - MARGIN, -9))
    score = score - IDLE_DECAY * np.maximum(0, (at[i] - newest) / H - GRACE)
    # a story whose members name mostly another match is not this one
    if rule:
        score[np.bincount(s, weights=other[keep], minlength=n) > np.bincount(s, weights=this[keep], minlength=n)] = -9
    best = int(np.argmax(score))
    return (ids[best], f'{score[best]:.3f}') if score[best] >= THRESHOLD else (-1, f'{score[best]:.3f}')

out = []
def say(line=''):
    print(line, flush=True); out.append(line)

members = defaultdict(list)
for i in range(N): members[DB[i]].append(i)
todo = [i for i in np.where(HAS)[0]]
t = time.time()
agree, moved, rows_out = 0, [], []
for n_done, i in enumerate(todo):
    base, sb = decide(i, False)
    if base == DB[i] or (base == -1 and len(members[DB[i]]) == 1): agree += 1
    else: continue                       # the replay does not see what the run saw: left out
    rule, sr = decide(i, True)
    if rule != base: moved.append((i, base, rule, sb, sr))
    if n_done % 200 == 0: print(f'{n_done}/{len(todo)} {time.time() - t:.0f} s', flush=True)
say(f'{N} English news of 36 h, {len(todo)} with a matchup; the replay as today gives the database decision for {agree}')
say(f'the matchup rule changes {len(moved)} of these decisions ({len(moved) / agree:.1%})')
random.seed(7)
def show(j_list): return ' // '.join(META[j]['title'][:75] for j in j_list[:4])
for i, base, rule, sb, sr in random.sample(moved, min(60, len(moved))):
    say(f'\n* {medium[i]} | {META[i]["title"]}')
    say(f'  today {sb} -> {len(members[base])} news: ' + show([j for j in members[base] if j != i and created[j] <= created[i]]))
    say(f'  rule  {sr} -> ' + (f'{len(members[rule])} news: ' + show(members[rule]) if rule != -1 else 'a story of its own'))
open(f'{D}/replay.txt', 'w', encoding='utf-8').write('\n'.join(out))
