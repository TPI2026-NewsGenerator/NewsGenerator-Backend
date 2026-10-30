# Texts a second of one engine of embedder.py, on texts of the ingestion (a title, a title + the start
# of its description), sent by 16 as the server sends them to a processor (CPU_BATCH of embedder.js)
# VARIANT=int8pc THREADS=6 python speed.py texts.json [rounds=1]
import json
import sys
import time

from embedder import VARIANT, THREADS, encode

texts = json.load(open(sys.argv[1], encoding='utf-8'))
rounds = int(sys.argv[2]) if len(sys.argv) > 2 else 1
encode(texts[:16])          # warm up
for r in range(rounds):
    started = time.time()
    for k in range(0, len(texts), 16):
        encode(texts[k:k + 16])
    seconds = time.time() - started
    print(json.dumps({'variant': VARIANT, 'threads': THREADS, 'texts': len(texts), 'seconds': round(seconds, 1),
                      'textsPerSecond': round(len(texts) / seconds, 2)}), flush=True)
