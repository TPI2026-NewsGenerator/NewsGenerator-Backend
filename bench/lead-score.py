# Reading the articles during the ingestion, stage 2: the text vector of a news made from its title +
# the start of the article instead of its title + the RSS description, scored on what was judged by
# hand on the rel3 corpus (feeds of 24.09):
#  - relevance: 4 profiles, stories judged 0/1/2, ranked as production does (rank_stories: one vector
#    per interest, weight * (dense + 0.5 sparse), a story scores its best article); the 40 first go to
#    the AI, so both the top 10 and the known relevant stories reaching the 40 are counted
#  - grouping: the multi-media stories split into facts (tpl/facts.json); cross-media pairs of the
#    same fact vs two facts, separated by the cosine of their text vectors (the text check of
#    assign_stories needs the average over the other media >= 0.6)
# python bench/lead-score.py   (after bench/lead-build.mjs; the embedder must answer)
import json, os, pickle, re, sys, urllib.request, math
import numpy as np
from scipy.sparse import csr_matrix

B = 'bench/data'
L = f'{B}/legacy'
C = json.load(open(f'{L}/rel3/corpus2.json', encoding='utf-8'))
P = json.load(open(f'{L}/rel3/profiles.json', encoding='utf-8'))
S = json.load(open(f'{L}/rel3/stories.json', encoding='utf-8'))
J = json.load(open(f'{L}/rel3/judgments.json', encoding='utf-8'))
# the stories the variants brought that the first judging never saw, judged the same way (--unjudged)
if os.path.exists(f'{B}/lead/judged-extra.json'):
    for n, extra in json.load(open(f'{B}/lead/judged-extra.json', encoding='utf-8')).items(): J[n].update(extra)
FACTS = json.load(open(f'{L}/tpl/facts.json', encoding='utf-8'))
MULTI = json.load(open(f'{L}/tpl/multi.json', encoding='utf-8'))
PAGES = json.load(open(f'{B}/lead/pages.json', encoding='utf-8'))
story_of, stories = S['story_of'], S['stories']
art = {a['key']: a for a in C}
keys = [a['key'] for a in C]

env = dict(re.findall(r'^([A-Z_]+)=(.*)$', open('.env', encoding='utf-8').read(), re.M))
URL = env.get('EMBEDDER_URL', 'http://127.0.0.1:8020').strip().strip('"')
TOKEN = env.get('EMBEDDER_TOKEN', '').strip().strip('"')

words = lambda t: (t or '').split()
rich = lambda a: (a['title'] + '. ' + a['description'][:400]).strip(' .') if a['description'] else a['title']
def lead(a, n):
    p = PAGES.get(a['key'])
    return ' '.join(words(p['start'])[:n]) if p and p['words'] >= 60 else None
def with_lead(a, n):
    l = lead(a, n)
    return f"{a['title']}. {l}" if l else rich(a)
def short_desc(a, n, under=20):
    return with_lead(a, n) if len(words(a['description'])) < under else rich(a)

VARIANTS = {
    'title + RSS description (today)': rich,
    'title + 120 first words':         lambda a: with_lead(a, 120),
    'title + 60 first words':          lambda a: with_lead(a, 60),
    'title + 250 first words':         lambda a: with_lead(a, 250),
    'description < 20 words -> 120':   lambda a: short_desc(a, 120),
}

# ---- vectors, cached by text
CACHE = f'{B}/lead/vectors.pkl'
cache = pickle.load(open(CACHE, 'rb')) if os.path.exists(CACHE) else {}
def embed(texts):
    todo = [t for t in dict.fromkeys(texts) if t not in cache]
    for i in range(0, len(todo), 128):
        batch = todo[i:i + 128]
        req = urllib.request.Request(f'{URL}/embed', data=json.dumps({'texts': batch}).encode(), method='POST',
                                     headers={'Content-Type': 'application/json', **({'Authorization': f'Bearer {TOKEN}'} if TOKEN else {})})
        body = json.load(urllib.request.urlopen(req, timeout=600))
        for t, d, s in zip(batch, body['dense'], body['sparse']): cache[t] = (np.array(d, np.float32), s or {})
        print(f'  embedded {min(i + 128, len(todo))}/{len(todo)}', end='\r', flush=True)
    if todo: pickle.dump(cache, open(CACHE, 'wb')); print()

queries = list(dict.fromkeys(i['text'] for p in P.values() for i in p['interests']))
texts = {v: [f(a) for a in C] for v, f in VARIANTS.items()}
embed(queries + [t for ts in texts.values() for t in ts])

vocab = {}
def csr(weights, width=None):
    r, c, v = [], [], []
    for n, w in enumerate(weights):
        for tok, x in w.items(): r.append(n); c.append(vocab.setdefault(tok, len(vocab))); v.append(x)
    return csr_matrix((v, (r, c)), shape=(len(weights), width or len(vocab)))

read = sum(1 for a in C if lead(a, 1))
short = sum(1 for a in C if len(words(a['description'])) < 20)
print(f'{len(C)} articles: {read} with the start of their page ({round(100 * read / len(C))}%), '
      f'{short} with a description under 20 words ({round(100 * short / len(C))}%)')

# ---- relevance
def relevance(ts):
    for t in ts + queries: [vocab.setdefault(k, len(vocab)) for k in cache[t][1]]
    D = np.stack([cache[t][0] for t in ts]); Q = np.stack([cache[q][0] for q in queries])
    W = csr([cache[t][1] for t in ts], len(vocab)); WQ = csr([cache[q][1] for q in queries], len(vocab))
    H = D @ Q.T + 0.5 * (W @ WQ.T).toarray()
    col = {q: i for i, q in enumerate(queries)}
    out = {}
    for name, p in P.items():
        vis = np.array([a.get('profiles') is None or name in a['profiles'] for a in C])
        score = np.max(np.stack([i['weight'] * H[:, col[i['text']]] for i in p['interests']]), axis=0)
        score = np.where(vis, score, -9)
        best = {}
        for k, s in zip(keys, score):
            sid = story_of[k]
            if s > best.get(sid, -9): best[sid] = s
        out[name] = [sid for sid, _ in sorted(best.items(), key=lambda x: -x[1])]
    return out

print('\nRELEVANCE (4 profiles; judged: 2 fully, 1 partly, 0 not; ? = never judged)')
print(f'  {"variant":<34}{"top 10: relevant":>18}{"fully":>7}{"?":>4}{"   top 40: known relevant":>26}{"fully":>7}{"?":>5}')
for v, ts in texts.items():
    ranked = relevance(ts)
    r10 = f10 = u10 = r40 = f40 = u40 = 0; known = knownf = 0
    for name, ids in ranked.items():
        j = J[name]
        known += sum(g >= 1 for g in j.values()); knownf += sum(g == 2 for g in j.values())
        for n, (top, cut) in enumerate(((ids[:10], 10), (ids[:40], 40))):
            g = [j.get(s) for s in top]
            rel = sum(x is not None and x >= 1 for x in g); full = sum(x == 2 for x in g); unk = sum(x is None for x in g)
            if n == 0: r10 += rel; f10 += full; u10 += unk
            else: r40 += rel; f40 += full; u40 += unk
    print(f'  {v:<34}{r10:>12}/40{f10:>9}{u10:>4}{r40:>18}/{known:<5}{f40:>5}/{knownf:<3}{u40:>3}')

# ---- grouping: same fact vs two facts, cross-media pairs
medium = {m['key']: m['medium'] for s in MULTI for m in s['members']}
pairs = []
for sid, facts in FACTS.items():
    fact_of = {k: f for f, ks in enumerate(facts) for k in ks}
    ks = [k for k in fact_of if k in art]
    for x in range(len(ks)):
        for y in range(x + 1, len(ks)):
            a, b = ks[x], ks[y]
            if medium.get(a) and medium.get(a) == medium.get(b): continue
            pairs.append((a, b, fact_of[a] == fact_of[b]))
both_read = sum(1 for a, b, _ in pairs if lead(art[a], 1) and lead(art[b], 1))
print(f'\nGROUPING: {len(pairs)} cross-media pairs of {len(FACTS)} multi-media stories, {sum(s for *_, s in pairs)} of one fact, '
      f'{both_read} with both pages read')

def auc(pos, neg):
    allv = np.concatenate([pos, neg]); order = allv.argsort().argsort() + 1
    return (order[:len(pos)].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg))
print(f'  {"variant":<34}{"AUC":>6}{"  at 0.6: one fact kept":>25}{"two facts cut":>15}{"   two facts cut when 88% kept":>32}')
for v, f in VARIANTS.items():
    vec = {a['key']: cache[f(a)][0] for a in C}
    sims = np.array([float(vec[a] @ vec[b]) for a, b, _ in pairs]); same = np.array([s for *_, s in pairs])
    pos, neg = sims[same], sims[~same]
    at = np.quantile(pos, 0.12)
    print(f'  {v:<34}{auc(pos, neg):>6.3f}{(pos >= 0.6).mean():>24.0%}{(neg < 0.6).mean():>15.0%}{(neg < at).mean():>24.0%} (at {at:.2f})')

# ---- the stories a variant brings in the 40 that were never judged, to judge them by hand
if '--unjudged' in sys.argv:
    out = {}
    for v in VARIANTS:
        for name, ids in relevance(texts[v]).items():
            for rank, sid in enumerate(ids[:40]):
                if sid in J[name]: continue
                m = stories[sid]['members'][0]; a = art[m]
                out.setdefault(name, {})[sid] = {'rank': min(rank + 1, out.get(name, {}).get(sid, {}).get('rank', 99)),
                    'title': a['title'], 'description': a['description'][:200], 'start': ' '.join(words(PAGES.get(m, {}).get('start'))[:50])}
    json.dump({'rubric': {n: p['judge'] for n, p in P.items()}, 'stories': out}, open(f'{B}/lead/unjudged.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print({n: len(s) for n, s in out.items()})
