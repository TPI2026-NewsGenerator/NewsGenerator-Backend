#
#  Author: Fabian Rostello
#  Date: 13.10.2026
#  File: server.py
#  Description: The people, organisations and places a news names (named entities), found by GLiNER,
#               over HTTP for the server: every news gets them as it is read (see tagging-service.js)
#
# GLiNER multi v2.1 (urchade/gliner_multi-v2.1, Apache-2.0) reads every language of the feeds and is
# asked for the kinds wanted ("person", "organization", "location") instead of the fixed ones of a
# model trained for them. Measured on 294 news of 26 languages (bench/ner, 13.10.2026), on 3 cores of
# the server: 2.2 news a second on the title and 400 characters of the description, the same entities run
# after run; the title alone was 3 times faster but found 44% of them ("LFF", "Latvian Football
# Federation" are in the description). In int8 (ONNX of onnx-community, or PyTorch quantized) it found
# none: fp32 only.
#
#   python ner/server.py            listens on 127.0.0.1:8021 (NER_PORT to change it)
#
# On another machine (a graphics card tags the backlog of a month in hours, the processor of the server
# keeps up with the news of the day), ner/.env or the environment gives:
#   NER_HOST=0.0.0.0              the address to listen on, 127.0.0.1 when not given
#   NER_TOKEN=<32+ characters>    the secret the server sends (its NER_TOKEN, or EMBEDDER_TOKEN: the one
#                                 of the embedder is taken when NER_TOKEN is not given), required as
#                                 soon as the address is not this machine only
#   NER_THREADS=<n>               the threads of PyTorch on a processor, one per core when not given
#
# POST /entities  {"texts": ["...", "..."]}   with "Authorization: Bearer <token>" when a token is set
#   -> {"entities": [[{"text": "Gianni Infantino", "label": "person", "score": 0.93}, ...], ...]}
# GET /health  -> {"status": "ok", "model": "urchade/gliner_multi-v2.1", "device": "cpu" | "cuda"}

import hmac
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def load_env(path):
    """KEY=VALUE lines of ner/.env, the environment wins. Windows editors write it in UTF-16 or with a
    BOM (PowerShell 5, Notepad), which would hide the first key: both are read"""
    if not os.path.exists(path):
        if os.path.exists(path + '.txt'):
            print(f'{path}.txt found but not read: rename it to .env', flush=True)
        return
    data = open(path, 'rb').read()
    text = data.decode('utf-16') if data[:2] in (b'\xff\xfe', b'\xfe\xff') else data.decode('utf-8-sig')
    for line in text.splitlines():
        key, sep, value = line.strip().partition('=')
        if sep and not key.startswith('#'):
            os.environ.setdefault(key.strip(), value.strip().strip('"\''))
    print(f'Settings read from {path}', flush=True)


load_env(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))

MODEL_NAME = 'urchade/gliner_multi-v2.1'
HOST = os.environ.get('NER_HOST', '127.0.0.1')
PORT = int(os.environ.get('NER_PORT', '8021'))
TOKEN = os.environ.get('NER_TOKEN') or os.environ.get('EMBEDDER_TOKEN', '')
MIN_TOKEN = 32
MAX_TEXTS = 256                 # texts per request, the client sends batches
MAX_CHARS = 1000                # a title and the start of its description (the server sends 700 of it)
MAX_BODY = 4 * 1024 * 1024
# The kinds asked: each is read with every text, a fourth one costs time. An event ("UEFA Nations
# League") comes as an organisation
LABELS = ['person', 'organization', 'location']
THRESHOLD = 0.5
BATCH = 16                      # texts encoded together: more gave no speed on the processor

# nothing protects the port but the token: open to the network, it is required
if HOST not in ('127.0.0.1', '::1', 'localhost') and len(TOKEN) < MIN_TOKEN:
    sys.exit(f'NER_HOST={HOST} opens the tagger to the network: '
             f'set NER_TOKEN (or EMBEDDER_TOKEN) to a secret of at least {MIN_TOKEN} characters, the same in the server.')

import torch  # noqa: E402
from gliner import GLiNER  # noqa: E402

GPU = torch.cuda.is_available()
if not GPU and os.environ.get('NER_THREADS'):
    torch.set_num_threads(int(os.environ['NER_THREADS']))
model = GLiNER.from_pretrained(MODEL_NAME)
if GPU:
    model = model.to('cuda')
model.eval()
# one batch at a time: two requests at once would share the cores and both be slower
lock = threading.Lock()
print(f'Tagging on {torch.cuda.get_device_name(0) if GPU else "the processor"}', flush=True)


def tag(texts):
    found = []
    with lock, torch.inference_mode():
        for i in range(0, len(texts), BATCH * (4 if GPU else 1)):
            found += model.batch_predict_entities(texts[i:i + BATCH * (4 if GPU else 1)], LABELS, threshold=THRESHOLD)
    return [[{'text': entity['text'], 'label': entity['label'], 'score': round(float(entity['score']), 3)}
             for entity in entities] for entities in found]


class Handler(BaseHTTPRequestHandler):
    def answer(self, status, body):
        data = json.dumps(body, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == '/health':
            # the device tells the server how many texts to send at once (see tagging-service.js)
            return self.answer(200, {'status': 'ok', 'model': MODEL_NAME, 'device': 'cuda' if GPU else 'cpu'})
        return self.answer(404, {'error': 'Not found'})

    def authorized(self):
        if not TOKEN:
            return True
        given = self.headers.get('Authorization', '').encode('utf-8')
        return hmac.compare_digest(given, f'Bearer {TOKEN}'.encode('utf-8'))

    def do_POST(self):
        if self.path != '/entities':
            return self.answer(404, {'error': 'Not found'})
        if not self.authorized():
            return self.answer(401, {'error': 'Wrong or missing token.'})

        length = int(self.headers.get('Content-Length') or 0)
        if length <= 0 or length > MAX_BODY:
            return self.answer(400, {'error': 'The body must be a JSON object of at most 4 MB.'})
        try:
            texts = json.loads(self.rfile.read(length)).get('texts')
        except (ValueError, AttributeError):
            return self.answer(400, {'error': 'The body must be JSON: {"texts": [...]}.'})
        if not isinstance(texts, list) or not all(isinstance(text, str) for text in texts):
            return self.answer(400, {'error': '"texts" must be a list of strings.'})
        if len(texts) > MAX_TEXTS:
            return self.answer(400, {'error': f'At most {MAX_TEXTS} texts per request.'})
        if not texts:
            return self.answer(200, {'entities': []})

        started = time.time()
        # half of a character (a text cut inside an emoji) is replaced; an empty text names nothing
        texts = [text.encode('utf-8', 'replace').decode('utf-8')[:MAX_CHARS] for text in texts]
        try:
            found = tag([text if text.strip() else '.' for text in texts])
        except Exception as err:
            # an answer rather than a connection dropped: the server says why the batch failed
            print(f'{len(texts)} texts failed: {err!r}', flush=True)
            return self.answer(500, {'error': f'The texts could not be tagged: {err}'})
        print(f'{len(texts)} texts in {time.time() - started:.1f} s', flush=True)
        return self.answer(200, {'entities': found})

    def log_message(self, format, *args):
        pass                    # one line per batch above is enough


if __name__ == '__main__':
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f'Tagger listening on http://{HOST}:{PORT}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)
