#
#  Author: Fabian Rostello
#  Date: 24.09.2026
#  File: server.py
#  Description: bge-m3 embeddings (dense + sparse) for the server, over HTTP on this machine only
#
# Ollama serves bge-m3 but only its dense vector. The sparse part, the weight bge-m3 gives to each
# word of a text, is what keeps two templates apart ("Egypt vs Angola - Betting Tips" and "Togo vs
# Burundi - Betting Tips" share a meaning but no name), and it is only produced by FlagEmbedding.
# Measured on the stories judged by hand: dense + sparse gave 96% of right stories, dense alone less.
#
#   python embedder/server.py            listens on 127.0.0.1:8020 (EMBEDDER_PORT to change it)
#
# On another machine (a graphics card encodes the 48 hours of news in a minute or two, the processor of
# the server in hours), embedder/.env or the environment gives:
#   EMBEDDER_HOST=0.0.0.0              the address to listen on, 127.0.0.1 when not given
#   EMBEDDER_TOKEN=<32+ characters>    the secret the server sends (its EMBEDDER_TOKEN), required as soon
#                                      as the address is not this machine only
# The firewall of that machine should also let only the server reach the port.
#
# POST /embed  {"texts": ["...", "..."]}   with "Authorization: Bearer <token>" when a token is set
#   -> {"dense": [[1024 floats], ...], "sparse": [{"token id": weight, ...}, ...]}
# GET /health  -> {"status": "ok", "model": "BAAI/bge-m3"}

import hmac
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer



def load_env(path):
    """KEY=VALUE lines of embedder/.env, the environment wins. Windows editors write it in UTF-16 or
    with a BOM (PowerShell 5, Notepad), which would hide the first key: both are read"""
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

MODEL_NAME = 'BAAI/bge-m3'
HOST = os.environ.get('EMBEDDER_HOST', '127.0.0.1')
PORT = int(os.environ.get('EMBEDDER_PORT', '8020'))
TOKEN = os.environ.get('EMBEDDER_TOKEN', '')
MIN_TOKEN = 32
MAX_TEXTS = 256                 # texts per request, the client sends batches
MAX_LENGTH = 256                # tokens read per text: a title and the start of its description
MAX_BODY = 8 * 1024 * 1024

# nothing protects the port but the token: open to the network, it is required
if HOST not in ('127.0.0.1', '::1', 'localhost') and len(TOKEN) < MIN_TOKEN:
    sys.exit(f'EMBEDDER_HOST={HOST} opens the embedder to the network: '
             f'set EMBEDDER_TOKEN to a secret of at least {MIN_TOKEN} characters, the same in the server.')

print(f'Loading {MODEL_NAME}...', flush=True)
import torch  # noqa: E402  (slow imports, after the message)
from FlagEmbedding import BGEM3FlagModel  # noqa: E402

GPU = torch.cuda.is_available()
BATCH_SIZE = 128 if GPU else 32
# fp32 on the graphics card too: the vectors stay those of the processor, the ones already stored and
# measured on the benches, and a card of 12 GB is fast enough without halving the precision
model = BGEM3FlagModel(MODEL_NAME, use_fp16=False, devices=['cuda:0' if GPU else 'cpu'])
print(f'Encoding on {torch.cuda.get_device_name(0) if GPU else "the processor"}', flush=True)
lock = threading.Lock()         # one encoding at a time: the model already uses every core, or the card


def embed(texts):
    with lock:
        out = model.encode(texts, batch_size=BATCH_SIZE, max_length=MAX_LENGTH,
                           return_dense=True, return_sparse=True, return_colbert_vecs=False)
    return {
        'dense': [[round(float(x), 6) for x in vector] for vector in out['dense_vecs']],
        'sparse': [{str(token): round(float(weight), 5) for token, weight in weights.items()}
                   for weights in out['lexical_weights']],
    }


class Handler(BaseHTTPRequestHandler):
    def answer(self, status, body):
        data = json.dumps(body).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == '/health':
            # the device tells the server how many texts to send at once (see embedder.js)
            return self.answer(200, {'status': 'ok', 'model': MODEL_NAME, 'device': 'cuda' if GPU else 'cpu'})
        return self.answer(404, {'error': 'Not found'})

    def authorized(self):
        if not TOKEN:
            return True
        given = self.headers.get('Authorization', '').encode('utf-8')
        return hmac.compare_digest(given, f'Bearer {TOKEN}'.encode('utf-8'))

    def do_POST(self):
        if self.path != '/embed':
            return self.answer(404, {'error': 'Not found'})
        if not self.authorized():
            return self.answer(401, {'error': 'Wrong or missing token.'})

        length = int(self.headers.get('Content-Length') or 0)
        if length <= 0 or length > MAX_BODY:
            return self.answer(400, {'error': 'The body must be a JSON object of at most 8 MB.'})

        try:
            texts = json.loads(self.rfile.read(length)).get('texts')
        except (ValueError, AttributeError):
            return self.answer(400, {'error': 'The body must be JSON: {"texts": [...]}.'})

        if not isinstance(texts, list) or not all(isinstance(text, str) for text in texts):
            return self.answer(400, {'error': '"texts" must be a list of strings.'})
        if len(texts) > MAX_TEXTS:
            return self.answer(400, {'error': f'At most {MAX_TEXTS} texts per request.'})
        if not texts:
            return self.answer(200, {'dense': [], 'sparse': []})

        started = time.time()
        # an empty text gives no vector: a single space is encoded instead, it matches nothing
        result = embed([text if text.strip() else ' ' for text in texts])
        print(f'{len(texts)} texts in {time.time() - started:.1f} s', flush=True)
        return self.answer(200, result)

    def log_message(self, format, *args):
        pass                    # one line per batch above is enough


if __name__ == '__main__':
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f'Embedder listening on http://{HOST}:{PORT}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)
