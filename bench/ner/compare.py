import json, sys
a, b = [json.load(open(f, encoding='utf-8')) for f in sys.argv[1:3]]
key = lambda e: (e['text'].lower(), e['label'])
both = only_a = only_b = 0
diffs = []
for ra, rb in zip(a, b):
    sa, sb = {key(e) for e in ra['entities']}, {key(e) for e in rb['entities']}
    both += len(sa & sb); only_a += len(sa - sb); only_b += len(sb - sa)
    if sa != sb: diffs.append((ra['lang'], sorted(sa - sb), sorted(sb - sa)))
print(f'same {both}, only first {only_a}, only second {only_b}, texts differing {len(diffs)}/{len(a)}')
for d in diffs[:25]: print(d)
