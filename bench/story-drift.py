# Stories that drift from day to day: assign_stories (db/add_briefing.sql) replayed offline on the news
# grouped since 24.09, run by run (every 20 minutes, by the time the news was saved), with variants of
# which members a news is compared with. Scored on the 40 long stories judged by hand
# (bench/data/story-drift/judged.json) and on the pairs of the search cards judged by hand
# (bench/data/story-cards).
# python bench/story-drift.py   (after bench/story-drift-export.mjs and bench/story-drift-sample.mjs)
import json, sys, time
import numpy as np
from collections import defaultdict
from scipy.sparse import csr_matrix

D = 'bench/data/story-drift'
META = json.load(open(f'{D}/meta.json', encoding='utf-8'))
N = len(META)
TITLE = np.fromfile(f'{D}/title_dense.f32', dtype=np.float32).reshape(N, 1024)
TEXT = np.fromfile(f'{D}/text_dense.f32', dtype=np.float32).reshape(N, 1024)
SPARSE_ROWS = json.load(open(f'{D}/title_sparse.json', encoding='utf-8'))
r, cidx, v = [], [], []
for i, row in enumerate(SPARSE_ROWS):
    for k, x in row.items(): r.append(i); cidx.append(int(k)); v.append(x)
SPARSE = csr_matrix((v, (r, cidx)), shape=(N, 250003), dtype=np.float32)

THRESHOLD, SPARSE_WEIGHT, MARGIN, TEXT_THRESHOLD = 0.70, 1.0, 0.5, 0.6
RUN = 20 * 60
H = 3600

at = np.array([m['at'] for m in META]); created = np.array([m['created'] for m in META])
lang = np.array([m['lang'] or '' for m in META]); medium = [m['medium'] for m in META]
figures = [tuple(m['figures']) for m in META]

codes = lambda values: np.unique(np.array(values, dtype=object).astype(str), return_inverse=True)[1]
MEDIUM = codes([m if m is not None else '(none)' for m in medium])
LINK = codes([m['link'] for m in META])
TITLE_CODE = codes([m['title'] for m in META])
FIG = codes([','.join(map(str, f)) for f in figures])
NO_FIG = FIG[[k for k, f in enumerate(figures) if not f][0]] if any(not f for f in figures) else -1

# per language, the news sorted by time: the members of a window are a slice, compared without a copy
LANGS = {}
for l in set(lang):
    idx = np.where(lang == l)[0]
    idx = idx[np.argsort(at[idx], kind='stable')]
    LANGS[l] = dict(idx=idx, at=at[idx], title=np.ascontiguousarray(TITLE[idx]), text=np.ascontiguousarray(TEXT[idx]),
                    sparse=SPARSE[idx].tocsr(), pos={g: k for k, g in enumerate(idx)})

def replay(window=48, anchor=False, max_age=None, max_idle=None, gap_decay=0.0, idle_decay=0.0, grace=6):
    """window: hours of the members compared (since = run - window)
       anchor: a story is judged on ALL its members, not only the ones in the window
       max_age: a story whose first news is older than this (hours before the run) takes no more news
       max_idle: a story whose newest news is older than this takes no more news
       gap_decay: the likeness of a news to each member loses this much per hour between the two,
                  after `grace` hours (the older the member, the closer the news must be to it)
       idle_decay: the score of a story loses this much per hour since its newest news, after `grace`"""
    story = np.full(N, -1)
    first, newest = [], []
    runs = defaultdict(list)
    for i in range(N): runs[int(created[i] // RUN)].append(i)
    for run in sorted(runs):
        now = (run + 1) * RUN
        since = now - window * H
        # the SQL takes the news of the run newest first
        for i in sorted(runs[run], key=lambda i: (-at[i], META[i]['id'])):
            L = LANGS[lang[i]]
            lo = 0 if anchor else int(np.searchsorted(L['at'], since))
            rows = L['idx'][lo:]
            st = story[rows]
            ok = st >= 0
            chosen = -1
            if ok.any():
                inwin = ok & (L['at'][lo:] >= since)
                again = inwin & (MEDIUM[rows] == MEDIUM[i]) & ((LINK[rows] == LINK[i]) | (TITLE_CODE[rows] == TITLE_CODE[i]))
                if again.any(): chosen = st[np.argmax(again)]
            if chosen < 0 and ok.any():
                k = L['pos'][i]
                sim = L['title'][lo:] @ L['title'][k] + SPARSE_WEIGHT * (L['sparse'][lo:] @ L['sparse'][k].T).toarray().ravel()
                text = L['text'][lo:] @ L['text'][k]
                if gap_decay: sim = sim - gap_decay * np.maximum(0, np.abs(at[i] - L['at'][lo:]) / H - grace)
                s = st[ok]; sim = sim[ok]; text = text[ok]
                same = MEDIUM[rows[ok]] == MEDIUM[i]
                other_fig = (FIG[rows[ok]] != NO_FIG) & (FIG[i] != NO_FIG) & (FIG[rows[ok]] != FIG[i])
                n = len(first)
                cnt = np.bincount(s, minlength=n); oth = np.bincount(s, weights=~same, minlength=n)
                sim_all = np.bincount(s, weights=sim, minlength=n)
                sim_oth = np.bincount(s, weights=sim * ~same, minlength=n)
                text_oth = np.bincount(s, weights=text * ~same, minlength=n)
                fig_any = np.bincount(s, weights=other_fig, minlength=n) > 0
                with np.errstate(invalid='ignore', divide='ignore'):
                    score = np.where(oth > 0,
                                     np.where(text_oth / oth >= TEXT_THRESHOLD, sim_oth / oth, -9),
                                     np.where(~fig_any, sim_all / cnt - MARGIN, -9))
                score[cnt == 0] = -9
                if anchor:
                    live = np.zeros(n, bool); live[np.unique(s[L['at'][lo:][ok] >= since])] = True
                    score[~live] = -9
                if max_age is not None: score[np.array(first) < now - max_age * H] = -9
                if max_idle is not None: score[np.array(newest) < now - max_idle * H] = -9
                if idle_decay: score = score - idle_decay * np.maximum(0, (at[i] - np.array(newest)) / H - grace)
                best = int(np.argmax(score))
                if score[best] >= THRESHOLD: chosen = best
            if chosen < 0:
                chosen = len(first); first.append(at[i]); newest.append(at[i])
            story[i] = chosen
            first[chosen] = min(first[chosen], at[i]); newest[chosen] = max(newest[chosen], at[i])
    return story

def stats(story, name):
    groups = defaultdict(list)
    for i, s in enumerate(story): groups[s].append(i)
    multi = [g for g in groups.values() if len({medium[i] for i in g}) > 1]
    span = np.array([(at[g].max() - at[g].min()) / H for g in map(np.array, multi)])
    print(f'  {name:<28} stories {len(groups):>6}, of several media {len(multi):>5}: '
          f'>24h {int((span >= 24).sum()):>4}, >48h {int((span >= 48).sum()):>4}')

def pairs_kept(story, ref):
    """cross-media pairs of one story in 'ref' that 'story' keeps together, and the reverse"""
    def pairs(s):
        g = defaultdict(list)
        for i, x in enumerate(s): g[x].append(i)
        out = set()
        for ms in g.values():
            if len(ms) > 60: continue
            for a in range(len(ms)):
                for b in range(a + 1, len(ms)):
                    if medium[ms[a]] != medium[ms[b]]: out.add((ms[a], ms[b]))
        return out
    p, q = pairs(story), pairs(ref)
    return len(p & q) / max(1, len(q)), len(p & q) / max(1, len(p))

pos = {m['id']: i for i, m in enumerate(META)}
SAMPLE = json.load(open(f'{D}/sample.json', encoding='utf-8'))
JUDGED = json.load(open(f'{D}/judged.json', encoding='utf-8'))

def on_sample(story, name, show=False):
    """how the variant cuts each long story of the sample: ONE should stay whole, DRIFT be cut"""
    res = defaultdict(lambda: [0, 0])
    lines = []
    for k, s in enumerate(SAMPLE):
        verdict = JUDGED['stories'][str(k)]
        idx = [pos[m['id']] for m in s['members'] if m['id'] in pos]
        parts = defaultdict(list)
        for i in idx: parts[story[i]].append(i)
        # the part holding most of the story's media
        n = len([p for p in parts.values() if len({medium[i] for i in p}) >= 1])
        res[verdict][0] += 1
        res[verdict][1] += n > 1
        if show and n > 1:
            lines.append(f'  #{k} {verdict}: ' + ' || '.join(
                ' / '.join(time.strftime('%d %H:%M', time.gmtime(at[i])) + ' ' + META[i]['title'][:50] for i in sorted(p, key=lambda i: at[i])[:3])
                for p in sorted(parts.values(), key=lambda p: at[p].min())))
    print(f'  {name:<28} ' + ', '.join(f'{v}: {cut}/{tot} cut' for v, (tot, cut) in sorted(res.items())))
    for l in lines: print(l)

VARIANTS = {
    'today (48 h window)': dict(),
    'window 24 h': dict(window=24),
    'anchored on all members': dict(anchor=True),
    'story at most 24 h old': dict(max_age=24),
    'story at most 36 h old': dict(max_age=36),
    'idle at most 12 h': dict(max_idle=12),
    # a likeness required that rises with the time between the news
    'gap decay 0.003': dict(gap_decay=0.003),
    'gap decay 0.006': dict(gap_decay=0.006),
    'gap decay 0.010': dict(gap_decay=0.010),
    'idle decay 0.003': dict(idle_decay=0.003),
    'idle decay 0.006': dict(idle_decay=0.006),
    'idle decay 0.010': dict(idle_decay=0.010),
}
if len(sys.argv) > 1: VARIANTS = {k: v for k, v in VARIANTS.items() if any(a in k for a in sys.argv[1:])}

ref = np.array([m['story'] for m in META])
print('the stories in the database')
stats(ref, 'database')
on_sample(ref, 'database')
for name, kw in VARIANTS.items():
    t = time.time()
    story = replay(**kw)
    np.save(f'{D}/replay-{name.replace(" ", "_")}.npy', story)
    print(f'\n{name} ({time.time() - t:.0f} s)')
    stats(story, name)
    kept, precise = pairs_kept(story, ref)
    print(f'  cross-media pairs of the database kept {kept:.0%}, its own pairs in the database {precise:.0%}')
    on_sample(story, name, show='--show' in sys.argv)
