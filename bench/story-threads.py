# Two levels instead of one: FACTS (the stories of assign_stories, strict over time) and THREADS that
# link the facts of one affair over days (a preview, its result, the reactions). Offline, on the
# replays of bench/story-drift.py (the facts) and the vectors of bench/story-drift-export.mjs.
#
# A thread is built story by story, in the order of their first news, same language: a story joins the
# thread whose stories it resembles on average (average link on the centroids of the stories: title +
# description dense, text_dense), above a threshold, or starts one. The centroids are those of the
# whole story (the replay knows its future members: at ingestion a story could change thread as it grows).
#
# Scored on the 316 news of the 40 long stories labelled by hand (bench/data/story-drift/facts.json,
# affair + fact of each), on the pairs of news of two media (a medium's own repeats left out):
#   same fact                       should share a fact (and so a thread)
#   same affair, another fact       should NOT share a fact, should share a thread
#   another affair                  should share neither
# and on the search cards judged by hand (bench/story-drift-pairs.py): one news together, different apart.
# Then the size of the threads, to see them swallow a whole subject.
# python bench/story-threads.py [--show]
import glob, json, re, sys, time
import numpy as np
from collections import defaultdict, Counter

D = 'bench/data/story-drift'
C = 'bench/data/story-cards'
META = json.load(open(f'{D}/meta.json', encoding='utf-8'))
N = len(META)
TEXT = np.fromfile(f'{D}/text_dense.f32', dtype=np.float32).reshape(N, 1024)
TITLE = np.fromfile(f'{D}/title_dense.f32', dtype=np.float32).reshape(N, 1024)
at = np.array([m['at'] for m in META]); lang = np.array([m['lang'] or '' for m in META])
medium = [m['medium'] for m in META]; title = [m['title'] for m in META]
H = 3600

# ---- the truth
pos = {m['id']: i for i, m in enumerate(META)}
SAMPLE = json.load(open(f'{D}/sample.json', encoding='utf-8'))
FACTS = json.load(open(f'{D}/facts.json', encoding='utf-8'))['stories']
pairs = []          # (story of the sample, i, j, kind)
for k, s in enumerate(SAMPLE):
    labels = FACTS[str(k)]
    assert len(labels) == len(s['members']), k
    ms = [(pos.get(m['id']), l) for m, l in zip(s['members'], labels)]
    for a in range(len(ms)):
        for b in range(a + 1, len(ms)):
            (i, la), (j, lb) = ms[a], ms[b]
            if i is None or j is None or medium[i] == medium[j]: continue
            kind = 'fact' if la == lb else 'affair' if la[0] == lb[0] else 'apart'
            pairs.append((k, i, j, kind))

key = {}
for i, m in enumerate(META): key.setdefault((m['title'][:110].strip(), m['medium']), i)
def members(label):
    t, med = re.match(r'^(.*?)\s+\[([^,\]]+)(?:, no story)?\]$', label).groups()
    return key.get((t.strip(), med))
cards, seen = [], set()
for u, j in (('unique.json', 'judged.json'), ('unique-v.json', 'judged-v.json')):
    unique = json.load(open(f'{C}/{u}', encoding='utf-8'))
    judged = json.load(open(f'{C}/{j}', encoding='utf-8')); judged = judged.get('judged', judged)
    for n, x in enumerate(unique):
        v = x.get('verdict') or judged.get(str(n))
        if v not in ('Y', 'N'): continue
        parts = [[i for i in (members(l) for l in p) if i is not None] for p in x['parts']]
        parts = [p for p in parts if p]
        k = tuple(sorted(tuple(sorted(p)) for p in parts))
        if len(parts) >= 2 and k not in seen: seen.add(k); cards.append((v, parts))


# ---- the threads
def threads(story, threshold, link='average', vectors=TEXT, other_media=None):
    """a thread for each story of 'story' (news -> story), see the top of the file.
       other_media: None, or the margin a story needs to join a thread through stories that share a
       medium with it (like assign_stories: a medium's own series look alike without being an affair);
       'never' to allow it only through stories of other media"""
    ids, inv = np.unique(story, return_inverse=True)
    S = len(ids)
    cent = np.zeros((S, 1024), np.float32)
    np.add.at(cent, inv, vectors)
    cent /= np.linalg.norm(cent, axis=1, keepdims=True)
    first = np.full(S, np.inf); np.minimum.at(first, inv, at)
    slang = np.empty(S, dtype=object); slang[inv] = lang
    if other_media is not None:
        from scipy.sparse import csr_matrix
        med = np.unique(np.array([m if m is not None else '(none)' for m in medium], dtype=object).astype(str), return_inverse=True)[1]
        MED = csr_matrix((np.ones(N, np.float32), (inv, med)), shape=(S, med.max() + 1))
        MED.data[:] = 1
    thread = np.full(S, -1)
    n = 0
    for l in set(slang):
        idx = np.where(slang == l)[0]
        idx = idx[np.argsort(first[idx], kind='stable')]
        C_ = cent[idx]
        if other_media is not None: M_ = MED[idx].tocsr()
        t_of = np.full(len(idx), -1)
        for p in range(len(idx)):
            if p:
                sim = C_[:p] @ C_[p]
                if other_media is not None:
                    # the stories sharing no medium with this one judge it; the others only with a margin
                    shared = (M_[:p] @ M_[p].T).toarray().ravel() > 0
                    k = t_of[:p] - t_base
                    oth = np.bincount(k, weights=~shared, minlength=n - t_base)
                    tot_o = np.bincount(k, weights=sim * ~shared, minlength=n - t_base)
                    tot_a = np.bincount(k, weights=sim, minlength=n - t_base)
                    cnt = np.bincount(k, minlength=n - t_base)
                    with np.errstate(invalid='ignore', divide='ignore'):
                        alone = -1 if other_media == 'never' else tot_a / cnt - other_media
                        score = np.where(oth > 0, tot_o / oth, alone)
                    score[cnt == 0] = -1
                    best = int(np.argmax(score))
                    if score[best] >= threshold: t_of[p] = best + t_base; continue
                    t_of[p] = n; n += 1
                    continue
                if link == 'average':
                    tot = np.bincount(t_of[:p] - t_base, weights=sim, minlength=n - t_base)
                    cnt = np.bincount(t_of[:p] - t_base, minlength=n - t_base)
                    with np.errstate(invalid='ignore', divide='ignore'): score = tot / cnt
                    score[cnt == 0] = -1
                else:
                    score = np.full(n - t_base, -1.0); np.maximum.at(score, t_of[:p] - t_base, sim)
                best = int(np.argmax(score))
                if score[best] >= threshold: t_of[p] = best + t_base; continue
            else:
                t_base = n
            t_of[p] = n; n += 1
        thread[idx] = t_of
    return thread[inv]


def score(fact, thread, name):
    res = defaultdict(lambda: [0, 0])
    per_story = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    for k, i, j, kind in pairs:
        f, t = fact[i] == fact[j], thread[i] == thread[j]
        if kind == 'fact': ok_f, ok_t = f, t
        elif kind == 'affair': ok_f, ok_t = not f, t
        else: ok_f, ok_t = not f, not t
        for lvl, ok in (('F', ok_f), ('T', ok_t)):
            res[(kind, lvl)][0] += ok; res[(kind, lvl)][1] += 1
            per_story[k][(kind, lvl)][0] += ok; per_story[k][(kind, lvl)][1] += 1
    # each story weighs the same: the big ones have hundreds of pairs
    macro = {}
    for key_ in res:
        r = [v[key_][0] / v[key_][1] for v in per_story.values() if key_ in v]
        macro[key_] = np.mean(r)
    y = sum(len({fact[i] for p in parts for i in p}) == 1 for v, parts in cards if v == 'Y')
    nn = sum(len({fact[i] for p in parts for i in p}) > 1 for v, parts in cards if v == 'N')
    ny = sum(v == 'Y' for v, _ in cards); nN = len(cards) - ny
    yt = sum(len({thread[i] for p in parts for i in p}) == 1 for v, parts in cards if v == 'Y')
    nt = sum(len({thread[i] for p in parts for i in p}) > 1 for v, parts in cards if v == 'N')
    f = lambda kind, lvl: f'{macro[(kind, lvl)]:.0%}'
    print(f'  {name:<44} fact kept {f("fact", "F")} (thread {f("fact", "T")}) | affair: facts apart {f("affair", "F")}, one thread {f("affair", "T")}'
          f' | other affair apart {f("apart", "T")} | cards Y {y}/{ny} (thread {yt}), N {nn}/{nN} (thread {nt})')


def sizes(fact, thread, show=0):
    by = defaultdict(set)
    for i in range(N): by[thread[i]].add(fact[i])
    n_st = np.array([len(v) for v in by.values()])
    news = Counter(thread)
    span = defaultdict(lambda: [np.inf, -np.inf])
    for i in range(N):
        s = span[thread[i]]; s[0] = min(s[0], at[i]); s[1] = max(s[1], at[i])
    multi = [t for t in by if len(by[t]) > 1]
    print(f'    threads of several facts {len(multi)}; facts per thread: max {n_st.max()}, '
          f'>=5 {(n_st >= 5).sum()}, >=10 {(n_st >= 10).sum()}; news in the 10 biggest {sum(c for _, c in news.most_common(10))}')
    if show:
        for t, c in news.most_common(show):
            idx = [i for i in range(N) if thread[i] == t]
            fs = defaultdict(list)
            for i in idx: fs[fact[i]].append(i)
            print(f'    thread {t}: {c} news, {len(fs)} facts, {(span[t][1] - span[t][0]) / H:.0f} h')
            for ms in sorted(fs.values(), key=lambda ms: at[ms].min())[:8]:
                i = min(ms, key=lambda i: at[i])
                print(f'      {time.strftime("%d %H:%M", time.gmtime(at[i]))} ({len(ms)}) {title[i][:90]}')
    return multi, by


ref = np.array([m['story'] for m in META])
LEVELS = {'database': ref}
for f in sorted(glob.glob(f'{D}/replay-*.npy')):
    name = f[len(D) + 8:-4].replace('_', ' ')
    if any(w in name for w in ('today', 'idle decay', 'gap decay 0.010')): LEVELS[name] = np.load(f)

print(f'{len(pairs)} pairs of two media: {Counter(k for *_, k in pairs)}; {len(cards)} search cards')
print('\nfacts alone (the thread is the fact)')
for name, fact in LEVELS.items(): score(fact, fact, name)

GRID = [('average', 0.80, None), ('average', 0.75, None), ('average', 0.70, None), ('average', 0.65, None), ('single', 0.80, None),
        # judged on the stories of other media, like assign_stories
        ('average', 0.75, 'never'), ('average', 0.75, 0.10), ('average', 0.75, 0.05),
        ('average', 0.70, 'never'), ('average', 0.70, 0.10)]
FACT_LEVELS = [a for a in sys.argv[1:] if not a.startswith('--')] or ['idle decay 0.003', 'idle decay 0.010', 'gap decay 0.010']
for name in FACT_LEVELS:
    fact = LEVELS[name]
    print(f'\nfacts: {name}, threads:')
    for link, t, other in GRID:
        if other is not None and name != 'idle decay 0.003': continue
        t0 = time.time()
        thread = threads(fact, t, link, other_media=other)
        label = f'{link} link {t}' + (f', same medium: {other}' if other is not None else '')
        score(fact, thread, f'{label} ({time.time() - t0:.0f} s)')
        sizes(fact, thread, show=6 if '--show' in sys.argv and link == 'average' and t == 0.75 and other is None else 0)
