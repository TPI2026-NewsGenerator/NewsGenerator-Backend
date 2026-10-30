# The threads of bench/story-threads.py built as the ingestion would: run by run (every 20 minutes, by
# the time the news was saved), each story touched in the run (a news joined it or started it) takes
# the centroid of the members it has at that time and is (re)assigned: it leaves its thread and joins
# the best one of its language active in the last THREAD_DAYS days, or starts one. The facts are the
# replay of assign_stories with the idle decay (bench/story-drift.py, idle decay 0.003).
# Same scores as bench/story-threads.py, plus what one run costs (stories touched, stories compared).
# python bench/story-threads-online.py [--sample]
import random
src = open('bench/story-threads.py', encoding='utf-8').read()
exec(src[:src.index('ref = np.array')])

created = np.array([m['created'] for m in META])
RUN = 20 * 60
THREAD_DAYS = 7
MED = np.unique(np.array([m if m is not None else '(none)' for m in medium], dtype=object).astype(str), return_inverse=True)[1]


def online(story, threshold=0.75, margin=0.10, merge=None, merge_margin=0.0):
    """merge: None, or the average likeness above which two threads touched in a run become one
       (the average of the likeness of their stories two by two, the product of their mean centroids)"""
    ids, inv = np.unique(story, return_inverse=True)
    S = len(ids)
    SUM = np.zeros((S, 1024), np.float32)       # sum of the text vectors of the members saved so far
    CEN = np.zeros((S, 1024), np.float32)       # normalized
    born = np.zeros(S, bool)
    slang = np.empty(S, dtype=object); slang[inv] = lang
    media = [set() for _ in range(S)]
    of_medium = defaultdict(set)                # medium -> stories
    thread = np.full(S, -1)
    t_active = np.zeros(S * 50)                 # thread -> time of its newest news (a story can start several over time)
    last = np.zeros(S)
    n_threads = 0
    cost = []
    runs = defaultdict(list)
    for i in range(N): runs[int(created[i] // RUN)].append(i)
    for run in sorted(runs):
        now = (run + 1) * RUN
        touched = set()
        for i in runs[run]:
            s = inv[i]
            SUM[s] += TEXT[i]; touched.add(s); born[s] = True
            media[s].add(MED[i]); of_medium[MED[i]].add(s)
            last[s] = max(last[s], at[i])
        touched = sorted(touched, key=lambda s: last[s])
        for s in touched: CEN[s] = SUM[s] / np.linalg.norm(SUM[s])
        compared = 0
        for s in touched:
            old = thread[s]; thread[s] = -1
            cand = np.where(born & (slang == slang[s]) & (thread >= 0))[0]
            cand = cand[t_active[thread[cand]] >= now - THREAD_DAYS * 86400]
            compared += len(cand)
            best, best_score = -1, -9
            if len(cand):
                sim = CEN[cand] @ CEN[s]
                mask = np.zeros(S, bool)
                for m in media[s]: mask[list(of_medium[m])] = True
                shared = mask[cand]
                ts, k = np.unique(thread[cand], return_inverse=True)
                cnt = np.bincount(k); oth = np.bincount(k, weights=~shared)
                tot = np.bincount(k, weights=sim); tot_o = np.bincount(k, weights=sim * ~shared)
                with np.errstate(invalid='ignore', divide='ignore'):
                    score = np.where(oth > 0, tot_o / oth, tot / cnt - margin)
                b = int(np.argmax(score))
                if score[b] >= threshold: best, best_score = ts[b], score[b]
            if best < 0:
                # back to its own thread when nothing else is better and it is still its own, else a new one
                best = old if old >= 0 and not (thread == old).any() else n_threads
                if best == n_threads: n_threads += 1
            thread[s] = best
            t_active[best] = max(t_active[best], last[s])
        if merge is not None:
            # a thread started twice (two facts of one affair born apart) is joined back: the threads
            # of the stories touched in this run against the other active threads of their language
            from scipy.sparse import csr_matrix
            act = np.where(born & (thread >= 0))[0]
            act = act[t_active[thread[act]] >= now - THREAD_DAYS * 86400]
            ts, k = np.unique(thread[act], return_inverse=True)
            ind = csr_matrix((np.ones(len(act), np.float32), (k, np.arange(len(act)))), shape=(len(ts), len(act)))
            mean = (ind @ CEN[act]) / np.bincount(k)[:, None]         # mean centroid of each active thread
            t_lang = np.empty(len(ts), dtype=object); t_lang[k] = slang[act]
            row = {t: r for r, t in enumerate(ts)}
            # the media of each thread: two threads sharing one merge only with the margin (a medium's
            # own series look alike without being one affair)
            rr, cc = [], []
            for a, s_ in enumerate(act):
                for m in media[s_]: rr.append(k[a]); cc.append(m)
            TM = csr_matrix((np.ones(len(rr), np.float32), (rr, cc)), shape=(len(ts), MED.max() + 1))
            TM.data[:] = 1
            gone = set()
            for t in {thread[s] for s in touched}:
                if t in gone or t not in row: continue
                r = row[t]
                avg = mean @ mean[r]
                avg[r] = -1; avg[t_lang != t_lang[r]] = -1; avg[[row[g] for g in gone if g in row]] = -1
                if merge_margin:
                    avg = avg - merge_margin * ((TM @ TM[r].T).toarray().ravel() > 0)
                b = int(np.argmax(avg))
                if avg[b] >= merge:
                    # the smaller thread joins the other: the mean of the pair, weighted by their stories
                    nb, nr = (thread == ts[b]).sum(), (thread == t).sum()
                    mean[b] = (mean[b] * nb + mean[r] * nr) / (nb + nr)
                    thread[thread == t] = ts[b]; t_active[ts[b]] = max(t_active[ts[b]], t_active[t])
                    if merge_margin: TM[b] = ((TM[b] + TM[r]) > 0).astype(np.float32)
                    gone.add(t)
        cost.append((len(touched), compared))
    return thread[inv], np.array(cost)


fact = np.load(f'{D}/replay-idle_decay_0.003.npy')
print(f'{len(pairs)} pairs, {len(cards)} search cards; facts: idle decay 0.003')
score(fact, fact, 'facts alone')
score(fact, threads(fact, 0.75, other_media=0.10), 'threads, whole stories known (story-threads.py)')
t0 = time.time()
thread, cost = online(fact)
score(fact, thread, f'threads run by run ({time.time() - t0:.0f} s)')
sizes(fact, thread)
print(f'    per run: stories touched median {int(np.median(cost[:, 0]))}, max {cost[:, 0].max()}; '
      f'stories compared median {int(np.median(cost[:, 1]))}, max {cost[:, 1].max()}')

if '--sample' in sys.argv:
    by = defaultdict(lambda: defaultdict(list))
    for i in range(N): by[thread[i]][fact[i]].append(i)
    multi = [t for t in by if len(by[t]) >= 3]
    random.seed(23)
    for t in random.sample(multi, 30):
        fs = sorted(by[t].values(), key=lambda ms: at[ms].min())
        print(f'thread {t}: {sum(map(len, fs))} news, {len(fs)} facts')
        for ms in fs[:6]:
            i = min(ms, key=lambda i: at[i])
            print(f'   {time.strftime("%d %H:%M", time.gmtime(at[i]))} ({len(ms)}n {len({medium[j] for j in ms})}m {medium[i][:12]}) {title[i][:90]}')
