#
#  Author: Fabian Rostello
#  Date: 24.09.2026
#  File: server.py
#  Description: bge-m3 embeddings (dense + sparse) for the server, over HTTP on this machine only
#
# Ollama serves bge-m3 but only its dense vector. The sparse part, the weight bge-m3 gives to each
# word of a text, is what keeps two templates apart ("Egypt vs Angola - Betting Tips" and "Togo vs
# Burundi - Betting Tips" share a meaning but no name), and it comes from a layer of its own
# (sparse_linear.pt of the model). Measured on the stories judged by hand: dense + sparse gave 96% of
# right stories, dense alone less.
#
# A graphics card encodes with FlagEmbedding (PyTorch). A processor encodes with ONNX Runtime, on the
# ONNX file of the BAAI repo: the same vectors (cosine 0.99997 with the stored ones, no likeness moved
# across a threshold, bench/int8 3.10.2026) 1.6 times faster on the 6 cores of the server (2.9 texts a
# second instead of 1.75). Without onnxruntime installed, the processor uses FlagEmbedding too.
# bge-m3 in int8 was 3 to 6 times faster but moved 10 to 15% of the closest news of a search or an
# interest: not used.
#
#   python embedder/server.py            listens on 127.0.0.1:8020 (EMBEDDER_PORT to change it)
#
# On another machine (a graphics card encodes the 48 hours of news in a minute or two, the processor of
# the server in hours), embedder/.env or the environment gives:
#   EMBEDDER_HOST=0.0.0.0              the address to listen on, 127.0.0.1 when not given
#   EMBEDDER_TOKEN=<32+ characters>    the secret the server sends (its EMBEDDER_TOKEN), required as soon
#                                      as the address is not this machine only
#   EMBEDDER_THREADS=<n>               the threads of ONNX Runtime, one per core when not given
# The firewall of that machine should also let only the server reach the port.
#
# POST /embed  {"texts": ["...", "..."]}   with "Authorization: Bearer <token>" when a token is set
#   -> {"dense": [[1024 floats], ...], "sparse": [{"token id": weight, ...}, ...]}
# GET /health  -> {"status": "ok", "model": "BAAI/bge-m3", "device": "cpu" | "cuda", "engine": "onnx" | "pytorch"}

import hmac
import json
import os
import shutil
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

GPU = torch.cuda.is_available()
BATCH_SIZE = 128 if GPU else 32
try:
    import onnxruntime  # noqa: E402
    ENGINE = 'pytorch' if GPU else 'onnx'
except ImportError:
    ENGINE = 'pytorch'
lock = threading.Lock()         # one encoding at a time: the model already uses every core, or the card


def onnx_folder():
    """The onnx/ folder of the model in a real folder next to the cache of Hugging Face (copied once
    from it, downloaded first when missing): ONNX Runtime refuses the external data of model.onnx
    behind the links of the cache ("External data path escapes model directory")"""
    from huggingface_hub import snapshot_download
    snapshot = snapshot_download(MODEL_NAME, allow_patterns=['onnx/*', 'sparse_linear.pt', '*.json', '*.model'])
    target = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(snapshot))), 'newsgenerator-bge-m3-onnx')
    os.makedirs(target, exist_ok=True)
    for name in os.listdir(os.path.join(snapshot, 'onnx')):
        source, copy = os.path.join(snapshot, 'onnx', name), os.path.join(target, name)
        if not os.path.exists(copy) or os.path.getsize(copy) != os.path.getsize(source):
            print(f'Copying onnx/{name} out of the cache...', flush=True)
            shutil.copyfile(source, copy + '.part')
            os.replace(copy + '.part', copy)
    return snapshot, target


if ENGINE == 'pytorch':
    from FlagEmbedding import BGEM3FlagModel  # noqa: E402
    # fp32 on the graphics card too: the vectors stay those of the processor, the ones already stored
    # and measured on the benches, and a card of 12 GB is fast enough without halving the precision
    model = BGEM3FlagModel(MODEL_NAME, use_fp16=False, devices=['cuda:0' if GPU else 'cpu'])

    def encode(texts):
        out = model.encode(texts, batch_size=BATCH_SIZE, max_length=MAX_LENGTH,
                           return_dense=True, return_sparse=True, return_colbert_vecs=False)
        return out['dense_vecs'], out['lexical_weights']
else:
    import numpy as np  # noqa: E402
    from transformers import AutoTokenizer  # noqa: E402

    snapshot, folder = onnx_folder()
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    # the threads encoding a batch: one per core by default; EMBEDDER_THREADS gives another number
    # (the 12 threads of the 6 cores of the server, --cpus 9 of its container)
    options = onnxruntime.SessionOptions()
    if os.environ.get('EMBEDDER_THREADS'):
        options.intra_op_num_threads = int(os.environ['EMBEDDER_THREADS'])
    session = onnxruntime.InferenceSession(os.path.join(folder, 'model.onnx'), sess_options=options,
                                           providers=['CPUExecutionProvider'])
    # the layer giving each token its weight, as FlagEmbedding: relu(sparse_linear(last hidden state))
    sparse_linear = torch.load(os.path.join(snapshot, 'sparse_linear.pt'), map_location='cpu', weights_only=True)
    SPARSE_WEIGHT = sparse_linear['weight'].numpy().reshape(-1)
    SPARSE_BIAS = float(sparse_linear['bias'].numpy().reshape(-1)[0])
    # tokens that are no word, left out of the sparse vector as FlagEmbedding does
    UNUSED = {tokenizer.convert_tokens_to_ids(tokenizer.special_tokens_map[name])
              for name in ('cls_token', 'eos_token', 'pad_token', 'unk_token') if name in tokenizer.special_tokens_map}

    def encode(texts):
        """dense: the first hidden state, normalized; sparse: the highest weight of each word. The
        texts go by length, as in FlagEmbedding, so a batch holds little padding"""
        dense, sparse = [None] * len(texts), [None] * len(texts)
        ids = tokenizer(texts, truncation=True, max_length=MAX_LENGTH)['input_ids']
        order = np.argsort([-len(tokens) for tokens in ids], kind='stable')
        for start in range(0, len(order), BATCH_SIZE):
            batch = order[start:start + BATCH_SIZE]
            width = max(len(ids[i]) for i in batch)
            input_ids = np.full((len(batch), width), tokenizer.pad_token_id, dtype=np.int64)
            mask = np.zeros((len(batch), width), dtype=np.int64)
            for row, i in enumerate(batch):
                input_ids[row, :len(ids[i])] = ids[i]
                mask[row, :len(ids[i])] = 1
            hidden = session.run(['token_embeddings'], {'input_ids': input_ids, 'attention_mask': mask})[0]
            first = hidden[:, 0]
            first = first / np.linalg.norm(first, axis=1, keepdims=True)
            weights = np.maximum(hidden @ SPARSE_WEIGHT + SPARSE_BIAS, 0)
            for row, i in enumerate(batch):
                dense[i] = first[row]
                words = {}
                for weight, token in zip(weights[row, :len(ids[i])], ids[i]):
                    if token not in UNUSED and weight > 0 and weight > words.get(token, 0):
                        words[token] = weight
                sparse[i] = words
        return dense, sparse

print(f'Encoding on {torch.cuda.get_device_name(0) if GPU else "the processor"} with '
      f'{"ONNX Runtime" if ENGINE == "onnx" else "PyTorch"}', flush=True)


def embed(texts):
    with lock:
        dense, sparse = encode(texts)
    return {
        'dense': [[round(float(x), 6) for x in vector] for vector in dense],
        'sparse': [{str(token): round(float(weight), 5) for token, weight in weights.items()}
                   for weights in sparse],
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
            return self.answer(200, {'status': 'ok', 'model': MODEL_NAME, 'device': 'cuda' if GPU else 'cpu',
                                     'engine': ENGINE})
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
        # an empty text gives no vector: a single space is encoded instead, it matches nothing. Half of
        # a character (a text cut inside an emoji) is refused by the tokenizer: it is replaced
        texts = [text.encode('utf-8', 'replace').decode('utf-8') for text in texts]
        try:
            result = embed([text if text.strip() else ' ' for text in texts])
        except Exception as err:
            # an answer rather than a connection dropped: the server says why the batch failed
            print(f'{len(texts)} texts failed: {err!r}', flush=True)
            return self.answer(500, {'error': f'The texts could not be encoded: {err}'})
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
