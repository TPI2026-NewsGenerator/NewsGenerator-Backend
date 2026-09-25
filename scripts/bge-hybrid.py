#
#  Author: Fabian Rostello
#  Date: 24.09.2026
#  File: bge-hybrid.py
#  Description: Scores the hand-judged pairs with the three heads of BGE-M3 (dense, sparse lexical
#               weights, ColBERT multi-vectors) against the trigrams used today. Ollama only ever
#               returns the dense head, so this bench is the only way to measure the sparse part
#               the hybrid plan rests on.
#               usage: node scripts/dump-judged.js judged.json && python scripts/bge-hybrid.py judged.json
#

import json
import sys
import time
import unicodedata

# ----------------------------------------------------------------------------------------------
# The measure used today, rewritten here so both benches read the same pairs with the same rule
# ----------------------------------------------------------------------------------------------
def strip(text):
    lowered = unicodedata.normalize('NFD', text).lower()
    return ''.join(c for c in lowered if not unicodedata.combining(c))


def trigrams(title):
    kept = ''.join(c if c.isascii() and c.isalnum() else ' ' for c in strip(title))
    out = set()
    for word in kept.split():
        padded = f'  {word} '
        for i in range(len(padded) - 2):
            out.add(padded[i:i + 3])
    return out


def jaccard(a, b):
    shared = len(a & b)
    return shared / (len(a) + len(b) - shared) if (a or b) else 0.0


# ----------------------------------------------------------------------------------------------
# Reading the pairs
# ----------------------------------------------------------------------------------------------
path = sys.argv[1] if len(sys.argv) > 1 else 'judged.json'
pairs = json.load(open(path, encoding='utf-8'))
titles = sorted({t for p in pairs for t in (p['a'], p['b'])})

same = [p for p in pairs if p['label'] == 'same']
apart = [p for p in pairs if p['label'] == 'apart']
cross = [p for p in apart if p['cross']]
print(f'{len(pairs)} judged pairs: {len(same)} must group, {len(apart)} must not '
      f'({len(cross)} of them between different media)')
print(f'{len(titles)} distinct titles\n')

# ----------------------------------------------------------------------------------------------
# BGE-M3, all three heads. This is what Ollama cannot give: /api/embed returns dense_vecs only.
# ----------------------------------------------------------------------------------------------
from FlagEmbedding import BGEM3FlagModel           # noqa: E402

print('loading BAAI/bge-m3 (first run downloads ~2.2 GB)...', flush=True)
started = time.time()
model = BGEM3FlagModel('BAAI/bge-m3', use_fp16=False)
print(f'  loaded in {time.time() - started:.1f} s', flush=True)

started = time.time()
out = model.encode(titles, batch_size=8, max_length=128,
                   return_dense=True, return_sparse=True, return_colbert_vecs=True)
elapsed = time.time() - started
print(f'  {len(titles)} titles encoded in {elapsed:.1f} s  ({elapsed / len(titles) * 1000:.0f} ms each)\n')

dense = {t: out['dense_vecs'][i] for i, t in enumerate(titles)}
sparse = {t: out['lexical_weights'][i] for i, t in enumerate(titles)}
colbert = {t: out['colbert_vecs'][i] for i, t in enumerate(titles)}


def cos(a, b):
    return float(a @ b)          # BGE-M3 dense vectors come out normalised


MEASURES = {
    'trigram (today)': lambda p: jaccard(trigrams(p['a']), trigrams(p['b'])),
    'bge dense': lambda p: cos(dense[p['a']], dense[p['b']]),
    'bge sparse': lambda p: float(model.compute_lexical_matching_score(sparse[p['a']], sparse[p['b']])),
    'bge colbert': lambda p: float(model.colbert_score(colbert[p['a']], colbert[p['b']])),
}
# the combination the BGE-M3 paper recommends, equal weight on the three heads
MEASURES['bge hybrid (d+s+c)'] = lambda p: (
    MEASURES['bge dense'](p) + MEASURES['bge sparse'](p) + MEASURES['bge colbert'](p)) / 3


# ----------------------------------------------------------------------------------------------
# Scoring. The four measures do not share a scale, so each is swept over its own range and judged
# on Youden's J (share of the must-group caught minus share of the must-not wrongly caught): the
# one number that compares measures whose scores are not comparable.
# ----------------------------------------------------------------------------------------------
def report(name, score):
    s = [score(p) for p in same]
    a = [score(p) for p in apart]
    c = [score(p) for p in cross]

    lo, hi = min(s + a), max(s + a)
    sweep = [lo + (hi - lo) * i / 40 for i in range(41)]

    best = max(sweep, key=lambda t: (sum(x >= t for x in s) / len(s) - sum(x >= t for x in a) / len(a)))
    caught = sum(x >= best for x in s)
    wrong = sum(x >= best for x in a)
    inflated = sum(x >= best for x in c)
    j = caught / len(s) - wrong / len(a)

    # the cut that lets nothing through that could inflate a corroboration count
    safe = [t for t in sweep if sum(x >= t for x in c) == 0]
    safe_cut = min(safe) if safe else None
    safe_caught = sum(x >= safe_cut for x in s) if safe_cut is not None else 0
    safe_wrong = sum(x >= safe_cut for x in a) if safe_cut is not None else 0

    print(f'{name:<20} best J={j:+.3f} at {best:.3f}   caught {caught:>2}/{len(s)}   '
          f'wrong {wrong:>2}/{len(a)}   inflating {inflated}/{len(c)}')
    if safe_cut is not None:
        print(f'{"":20} no count inflated at {safe_cut:.3f}: caught {safe_caught:>2}/{len(s)}, '
              f'wrong {safe_wrong:>2}/{len(a)}')
    return {'name': name, 'j': j, 'same': s, 'apart': a, 'cross': c, 'best': best}


print('=' * 92)
print('Each measure on its own')
print('=' * 92)
results = [report(name, score) for name, score in MEASURES.items()]

# ----------------------------------------------------------------------------------------------
# Mixes: each score divided by its own best cut, so 1.0 means "at the bar" for every measure, then
# the maximum groups when EITHER agrees and the minimum when BOTH do.
# ----------------------------------------------------------------------------------------------
bars = {r['name']: (r['best'] or 1e-9) for r in results}

print()
print('=' * 92)
print('Trigrams mixed with each head of the model')
print('=' * 92)
for other in ('bge dense', 'bge sparse', 'bge colbert'):
    for label, combine in (('OR', max), ('AND', min)):
        report(f'trigram {label} {other.split()[1]}', lambda p, o=other, c=combine: c(
            MEASURES['trigram (today)'](p) / bars['trigram (today)'],
            MEASURES[o](p) / bars[o]))

print()
print('=' * 92)
print('The pairs each measure gets worst')
print('=' * 92)
for r in results:
    worst_same = min(zip(r['same'], same), key=lambda x: x[0])
    worst_apart = max(zip(r['apart'], apart), key=lambda x: x[0])
    print(f'\n--- {r["name"]}')
    print(f'  missed  {worst_same[0]:.3f} [{worst_same[1]["set"]}] '
          f'{worst_same[1]["a"][:52]} / {worst_same[1]["b"][:52]}')
    print(f'  merged  {worst_apart[0]:.3f} [{worst_apart[1]["set"]}] '
          f'{worst_apart[1]["a"][:52]} / {worst_apart[1]["b"][:52]}')
