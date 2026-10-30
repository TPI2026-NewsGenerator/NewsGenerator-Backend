# Does a reranker (bge-reranker-v2-m3, reads the two texts together) tell "the same news" from "another
# news of the same subject" better than the bge-m3 vectors (each text alone, then compared)?
# Scored on the pairs judged by hand:
#   - data/legacy/tpl: 30 cards, each other article against the lead one: Y same news, N another news,
#     A same affair, another development (kept apart in the report)
#   - data/story-cards: the search cards judged by hand, Y one news, N different news; the pairs of titles
#     across the parts of a card, averaged per card
# python bench/rerank.py     (downloads BAAI/bge-reranker-v2-m3 the first time, ~2.3 GB; runs on the processor)
import json, os, re, sys, time
import numpy as np

B = os.path.dirname(os.path.abspath(__file__))
OUT = f'{B}/data/rerank'
os.makedirs(OUT, exist_ok=True)


def auc(pos, neg):
    """chance that a pair of the same news scores above a pair of two news"""
    if not pos or not neg: return float('nan')
    p, n = np.array(pos)[:, None], np.array(neg)[None, :]
    return float(((p > n).sum() + 0.5 * (p == n).sum()) / (p.size * n.size))


def best_split(pos, neg):
    """the threshold that gets the most pairs right, and how many"""
    best = (0, None)
    for t in sorted(set(pos) | set(neg)):
        right = sum(x >= t for x in pos) + sum(x < t for x in neg)
        if right > best[0]: best = (right, t)
    return best


# ---- the pairs
legacy = []
cards = json.load(open(f'{B}/data/legacy/tpl/cards.json', encoding='utf-8'))
truth = json.load(open(f'{B}/data/legacy/tpl/truth.json', encoding='utf-8'))
for name, labels in truth.items():
    ids = {c['id']: c for c in cards[name]['cards']}
    for cid, lab in labels.items():
        c = ids[cid]
        for other, l in zip(c['others'], lab):
            legacy.append(dict(card=cid, label=l, a=c['lead'], b=other))

strip = lambda label: re.match(r'^(.*?)\s+\[([^,\]]+)(?:, no story)?\]$', label).group(1).strip()
search = []
seen = set()
for u, j in (('unique.json', 'judged.json'), ('unique-v.json', 'judged-v.json')):
    unique = json.load(open(f'{B}/data/story-cards/{u}', encoding='utf-8'))
    judged = json.load(open(f'{B}/data/story-cards/{j}', encoding='utf-8'))
    judged = judged.get('judged', judged)
    for n, x in enumerate(unique):
        v = x.get('verdict') or judged.get(str(n))
        if v not in ('Y', 'N') or len(x['parts']) < 2: continue
        parts = [[strip(t) for t in p] for p in x['parts']]
        k = tuple(sorted(tuple(sorted(p)) for p in parts))
        if k in seen: continue
        seen.add(k)
        # the first 3 titles of each part, every pair across two parts
        pairs = [(a, b) for i in range(len(parts)) for j2 in range(i + 1, len(parts))
                 for a in parts[i][:3] for b in parts[j2][:3] if a != b]
        raw = [(a, b) for i in range(len(x['parts'])) for j2 in range(i + 1, len(x['parts']))
               for a in x['parts'][i][:3] for b in x['parts'][j2][:3] if strip(a) != strip(b)]
        if pairs: search.append(dict(label=v, pairs=pairs, raw=raw, search=x['search']))

text = lambda x: (x['title'] + '. ' + (x.get('description') or '')[:400]).strip(' .')
print(f'{len(legacy)} pairs of the legacy cards ({sum(p["label"] == "Y" for p in legacy)} Y, '
      f'{sum(p["label"] == "N" for p in legacy)} N, {sum(p["label"] == "A" for p in legacy)} A); '
      f'{len(search)} search cards ({sum(c["label"] == "Y" for c in search)} Y, {sum(c["label"] == "N" for c in search)} N), '
      f'{sum(len(c["pairs"]) for c in search)} pairs of titles', flush=True)

texts = sorted({x['title'] for p in legacy for x in (p['a'], p['b'])} | {text(x) for p in legacy for x in (p['a'], p['b'])}
               | {t for c in search for pair in c['pairs'] for t in pair})

# ---- bge-m3, as the ingestion uses it: dense + 1.0 sparse of the titles, dense of title + description
cache = f'{OUT}/bge-m3.npz'
if os.path.exists(cache):
    z = np.load(cache, allow_pickle=True)
    dense = dict(zip(z['texts'], z['dense'])); sparse = dict(zip(z['texts'], z['sparse']))
else:
    from FlagEmbedding import BGEM3FlagModel
    t = time.time()
    m3 = BGEM3FlagModel('BAAI/bge-m3', use_fp16=False, devices=['cpu'])
    out = m3.encode(texts, batch_size=32, max_length=256, return_dense=True, return_sparse=True)
    dense = dict(zip(texts, out['dense_vecs'])); sparse = dict(zip(texts, out['lexical_weights']))
    np.savez(cache, texts=np.array(texts, dtype=object), dense=np.array(out['dense_vecs']),
             sparse=np.array(out['lexical_weights'], dtype=object))
    print(f'bge-m3: {len(texts)} texts in {time.time() - t:.0f} s', flush=True)
    del m3


def m3_title(a, b):
    sa, sb = sparse[a], sparse[b]
    return float(dense[a] @ dense[b]) + sum(w * sb[k] for k, w in sa.items() if k in sb)


# ---- the reranker, both orders averaged (it reads a question then a passage, not a symmetric pair)
cache = f'{OUT}/reranker.json'
scores = json.load(open(cache, encoding='utf-8')) if os.path.exists(cache) else {}
todo = set()
for p in legacy:
    todo |= {(p['a']['title'], p['b']['title']), (p['b']['title'], p['a']['title']),
             (text(p['a']), text(p['b'])), (text(p['b']), text(p['a']))}
for c in search:
    for a, b in c['pairs']: todo |= {(a, b), (b, a)}
todo = [k for k in todo if f'{k[0]}\x1f{k[1]}' not in scores]
if todo:
    from FlagEmbedding import FlagReranker
    t = time.time()
    rr = FlagReranker('BAAI/bge-reranker-v2-m3', use_fp16=False, devices=['cpu'])
    for s in range(0, len(todo), 64):
        chunk = todo[s:s + 64]
        for k, v in zip(chunk, rr.compute_score([list(k) for k in chunk], normalize=True, max_length=512)):
            scores[f'{k[0]}\x1f{k[1]}'] = float(v)
        json.dump(scores, open(cache, 'w', encoding='utf-8'))
        print(f'  reranker {s + len(chunk)}/{len(todo)} pairs, {time.time() - t:.0f} s', flush=True)
rerank = lambda a, b: (scores[f'{a}\x1f{b}'] + scores[f'{b}\x1f{a}']) / 2

# ---- the report
def report(name, rows):
    """rows: (label, score)"""
    pos = [s for l, s in rows if l == 'Y']; neg = [s for l, s in rows if l == 'N']; amb = [s for l, s in rows if l == 'A']
    right, t = best_split(pos, neg)
    line = f'  {name:<34} AUC {auc(pos, neg):.3f}   best threshold {t:.3f}: {right}/{len(pos) + len(neg)} right'
    if amb: line += f'   (A above it {sum(x >= t for x in amb)}/{len(amb)})'
    print(line)


print('\nlegacy cards, each article against the lead one (Y same news vs N another news)')
report('bge-m3 titles (dense + sparse)', [(p['label'], m3_title(p['a']['title'], p['b']['title'])) for p in legacy])
report('bge-m3 title + description dense', [(p['label'], float(dense[text(p['a'])] @ dense[text(p['b'])])) for p in legacy])
report('reranker titles', [(p['label'], rerank(p['a']['title'], p['b']['title'])) for p in legacy])
report('reranker title + description', [(p['label'], rerank(text(p['a']), text(p['b']))) for p in legacy])

print('\nsearch cards, the pairs of titles across its parts averaged (Y one news vs N different news)')
report('bge-m3 titles (dense + sparse)', [(c['label'], np.mean([m3_title(a, b) for a, b in c['pairs']])) for c in search])
report('reranker titles', [(c['label'], np.mean([rerank(a, b) for a, b in c['pairs']])) for c in search])

# the same cards with the vectors stored at ingestion (bench/data/story-drift), for the pairs whose two
# news are found there: title + description dense, and the title score of assign_stories
D = f'{B}/data/story-drift'
if os.path.exists(f'{D}/meta.json'):
    META = json.load(open(f'{D}/meta.json', encoding='utf-8'))
    TEXT = np.fromfile(f'{D}/text_dense.f32', dtype=np.float32).reshape(len(META), 1024)
    where = {}
    for i, m in enumerate(META): where.setdefault((m['title'][:110].strip(), m['medium']), i)
    def found(label):
        t, med = re.match(r'^(.*?)\s+\[([^,\]]+)(?:, no story)?\]$', label).groups()
        return where.get((t.strip(), med))
    rows_t, rows_r, rows_m = [], [], []
    for c in search:
        got = [(found(a), found(b), strip(a), strip(b)) for a, b in c['raw']]
        got = [g for g in got if g[0] is not None and g[1] is not None]
        if not got: continue
        rows_t.append((c['label'], np.mean([float(TEXT[i] @ TEXT[j]) for i, j, _, _ in got])))
        rows_r.append((c['label'], np.mean([rerank(a, b) for _, _, a, b in got])))
        rows_m.append((c['label'], np.mean([m3_title(a, b) for _, _, a, b in got])))
    print(f'\nsearch cards whose news have their stored vectors ({len(rows_t)} cards)')
    report('bge-m3 titles (dense + sparse)', rows_m)
    report('bge-m3 title + description dense', rows_t)
    report('reranker titles', rows_r)

# the disagreements, to read
if '--show' in sys.argv:
    rows = [(p['label'], m3_title(p['a']['title'], p['b']['title']), rerank(text(p['a']), text(p['b'])),
             p['a']['title'], p['b']['title']) for p in legacy if p['label'] != 'A']
    rows.sort(key=lambda r: r[2])
    print('\nlegacy pairs, by reranker score (label, bge-m3, reranker)')
    for l, m, r, a, b in rows: print(f'  {l} {m:.2f} {r:.2f}  {a[:60]}  ||  {b[:60]}')
