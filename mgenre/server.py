#
#  Author: Fabian Rostello
#  Date: 22.10.2026
#  File: server.py
#  Description: mGENRE (multilingual entity linking, facebook/mgenre-wiki) over HTTP, to RANK the items of
#               Wikidata a name may be: given the sentence naming it and the titles of the candidates
#               (found live by the server, so a player of 2026 is one), it gives the log-probability of each
#               title given the sentence. Not the model's own list of 2021 titles (its prefix tree is not used)
#
# BENCH, not in production: see bench/mgenre (the 137 cases of bench/context). The licence of GENRE is
# CC-BY-NC 4.0 (non-commercial). On a machine without a graphics card, in fp32 (2.5 GB of weights) or int8
# (the linear layers of the 12+12 layers quantized, the 256 000 word embeddings and the output layer kept):
#
#   scp -r server/mgenre srv2:~/newsgenerator-mgenre                         (laptop, cmd)
#   cd ~/newsgenerator-mgenre && cp ~/newsgenerator-ner/token.env token.env (srv2)
#   docker build -t newsgenerator-mgenre:cpu .
#   docker run -d --name newsgenerator-mgenre --restart unless-stopped --cpus 4 --cpu-shares 128 --memory 5g \
#     -p <address>:8022:8022 --env-file token.env -e MGENRE_THREADS=4 -e MGENRE_MODES=fp32 \
#     -v "$PWD/cache:/cache" newsgenerator-mgenre:cpu
#
# The first start downloads the model (2.47 GB) into the cache. MGENRE_MODES: "fp32", "int8" or "fp32,int8"
# (both in memory: about 4.5 GB, give the container 7g). MGENRE_THREADS: the threads of PyTorch.
#
# POST /rank {"items": [{"id": "1", "source": "[START] OL [END] a gagné ...", "targets": ["Olympique Lyonnais >> en", ...]}],
#             "mode": "fp32"}      with "Authorization: Bearer <token>" when a token is set
#   -> {"results": [{"id": "1", "sum": [log-probabilities of each target], "length": [tokens of each], "ms": 812}]}
# POST /generate {"sources": ["[START] OL [END] ..."], "beams": 5, "mode": "fp32"}
#   -> {"results": [{"texts": ["Olympique Lyonnais >> fr", ...], "scores": [...]}]}   (no prefix tree: to see that
#      the format of the targets is the one the model writes)
# GET /health -> {"status": "ok", "model": "facebook/mgenre-wiki", "device": "cpu" | "cuda", "modes": [...]}

import copy
import hmac
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL_NAME = 'facebook/mgenre-wiki'
HOST = os.environ.get('MGENRE_HOST', '0.0.0.0')
PORT = int(os.environ.get('MGENRE_PORT', '8022'))
TOKEN = os.environ.get('MGENRE_TOKEN') or os.environ.get('NER_TOKEN') or os.environ.get('EMBEDDER_TOKEN', '')
MODES = [mode for mode in os.environ.get('MGENRE_MODES', 'fp32').split(',') if mode in ('fp32', 'int8')] or ['fp32']
MIN_TOKEN = 32
MAX_BODY = 4 * 1024 * 1024
MAX_ITEMS = 32                  # sentences per request
MAX_TARGETS = 16                # candidates of one sentence
MAX_SOURCE = 256                # tokens of the sentence

if HOST not in ('127.0.0.1', '::1', 'localhost') and len(TOKEN) < MIN_TOKEN:
    sys.exit(f'MGENRE_HOST={HOST} opens the ranker to the network: '
             f'set MGENRE_TOKEN (or NER_TOKEN, EMBEDDER_TOKEN) to a secret of at least {MIN_TOKEN} characters.')

import torch  # noqa: E402
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer  # noqa: E402
from scoring import generate, log_probabilities  # noqa: E402

GPU = torch.cuda.is_available()
if not GPU and os.environ.get('MGENRE_THREADS'):
    torch.set_num_threads(int(os.environ['MGENRE_THREADS']))

tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
base = AutoModelForSeq2SeqLM.from_pretrained(MODEL_NAME).eval()
models = {}


def quantized(model):
    """the linear layers of the encoder and the decoder in int8 (dynamic quantization of PyTorch, for the processor);
    the word embeddings (256 000 x 1024) and the output layer stay as they are: it is the logits that tell the
    titles apart"""
    torch.ao.quantization.quantize_dynamic(model.model, {torch.nn.Linear}, dtype=torch.qint8, inplace=True)
    return model


if 'fp32' in MODES:
    models['fp32'] = base.to('cuda') if GPU else base
    if 'int8' in MODES:
        models['int8'] = quantized(copy.deepcopy(base))
else:
    models['int8'] = quantized(base)
# one request at a time: two would share the cores and both be slower
lock = threading.Lock()
print(f'Ranking on {torch.cuda.get_device_name(0) if GPU else "the processor"}, modes {list(models)}, '
      f'{torch.get_num_threads()} threads', flush=True)


class Handler(BaseHTTPRequestHandler):
    def answer(self, status, body):
        data = json.dumps(body, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def authorized(self):
        if not TOKEN:
            return True
        given = self.headers.get('Authorization', '').encode('utf-8')
        return hmac.compare_digest(given, f'Bearer {TOKEN}'.encode('utf-8'))

    def do_GET(self):
        if self.path == '/health':
            return self.answer(200, {'status': 'ok', 'model': MODEL_NAME, 'device': 'cuda' if GPU else 'cpu', 'modes': list(models)})
        return self.answer(404, {'error': 'Not found'})

    def do_POST(self):
        if self.path not in ('/rank', '/generate'):
            return self.answer(404, {'error': 'Not found'})
        if not self.authorized():
            return self.answer(401, {'error': 'Wrong or missing token.'})
        length = int(self.headers.get('Content-Length') or 0)
        if length <= 0 or length > MAX_BODY:
            return self.answer(400, {'error': 'The body must be a JSON object of at most 4 MB.'})
        try:
            body = json.loads(self.rfile.read(length))
        except ValueError:
            return self.answer(400, {'error': 'The body must be JSON.'})
        mode = body.get('mode') or MODES[0]
        if mode not in models:
            return self.answer(400, {'error': f'mode must be one of {list(models)}.'})
        try:
            started = time.time()
            if self.path == '/rank':
                items = body.get('items')
                if not isinstance(items, list) or len(items) > MAX_ITEMS:
                    return self.answer(400, {'error': f'"items" must be a list of at most {MAX_ITEMS}.'})
                results = []
                for item in items:
                    targets = item.get('targets') or []
                    if not isinstance(item.get('source'), str) or not targets or len(targets) > MAX_TARGETS:
                        return self.answer(400, {'error': f'each item needs a "source" and 1 to {MAX_TARGETS} "targets".'})
                    began = time.time()
                    with lock:
                        sums, lengths = log_probabilities(models[mode], tokenizer, item['source'], targets, MAX_SOURCE)
                    results.append({'id': item.get('id'), 'sum': [round(s, 4) for s in sums], 'length': lengths,
                                    'ms': round((time.time() - began) * 1000)})
            else:
                sources = body.get('sources')
                if not isinstance(sources, list) or not all(isinstance(s, str) for s in sources) or len(sources) > MAX_ITEMS:
                    return self.answer(400, {'error': f'"sources" must be a list of at most {MAX_ITEMS} strings.'})
                with lock:
                    results = generate(models[mode], tokenizer, sources, int(body.get('beams') or 5), MAX_SOURCE)
            print(f'{self.path} {mode}: {len(results)} in {time.time() - started:.1f} s', flush=True)
            return self.answer(200, {'results': results})
        except Exception as err:
            print(f'{self.path} failed: {err!r}', flush=True)
            return self.answer(500, {'error': f'Not ranked: {err}'})

    def log_message(self, format, *args):
        pass


if __name__ == '__main__':
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f'Ranker listening on http://{HOST}:{PORT}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)
