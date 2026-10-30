# The embedder of the server (embedder/server.py) with another engine, to compare their vectors and
# their speed on the same texts. Same request and answer: POST /embed {"texts": [...]} ->
# {"dense": [[1024 floats]], "sparse": [{"token id": weight}]}, on 127.0.0.1 only, no token.
#   VARIANT=torch   FlagEmbedding in fp32, what the server runs (the reference)
#   VARIANT=onnx    the ONNX file of the BAAI repo in fp32 (checks the computation below)
#   VARIANT=int8 / int8pc   that file quantized by quantize.py
# The dense vector is the normalized first hidden state, the sparse one relu(sparse_linear) of each
# token, the highest weight of each word kept, without the special tokens: as FlagEmbedding does.
# VARIANT=int8 PORT=8021 THREADS=6 bench/int8/.venv/Scripts/python bench/int8/embedder.py
import glob
import json
import os
import threading
import time
from collections import defaultdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

VARIANT = os.environ.get('VARIANT', 'int8')
PORT = int(os.environ.get('PORT', '8021'))
THREADS = int(os.environ.get('THREADS', '0')) or None
MAX_LENGTH = 256                # as embedder/server.py
BATCH_SIZE = 32
here = os.path.dirname(os.path.abspath(__file__))
hub = os.path.join(os.environ.get('HF_HOME', os.path.expanduser('~/.cache/huggingface')), 'hub')
snapshot = glob.glob(os.path.join(hub, 'models--BAAI--bge-m3', 'snapshots', '*', ''))[0]

import torch  # noqa: E402
if THREADS:
    torch.set_num_threads(THREADS)

if VARIANT == 'torch':
    from FlagEmbedding import BGEM3FlagModel
    model = BGEM3FlagModel('BAAI/bge-m3', use_fp16=False, devices=['cpu'])

    def encode(texts):
        out = model.encode(texts, batch_size=BATCH_SIZE, max_length=MAX_LENGTH,
                           return_dense=True, return_sparse=True, return_colbert_vecs=False)
        return [list(map(float, v)) for v in out['dense_vecs']], [dict(w) for w in out['lexical_weights']]
else:
    import onnxruntime as ort
    from transformers import AutoTokenizer
    tokenizer = AutoTokenizer.from_pretrained('BAAI/bge-m3')
    path = os.path.join(here, 'models', 'fp32' if VARIANT == 'onnx' else VARIANT, 'model.onnx')
    options = ort.SessionOptions()
    if THREADS:
        options.intra_op_num_threads = THREADS
    session = ort.InferenceSession(path, options, providers=['CPUExecutionProvider'])
    linear = torch.load(os.path.join(snapshot, 'sparse_linear.pt'), map_location='cpu')
    weight = linear['weight'].numpy().reshape(-1)       # 1024
    bias = float(linear['bias'].numpy().reshape(-1)[0])
    unused = {tokenizer.convert_tokens_to_ids(tokenizer.special_tokens_map[t])
              for t in ['cls_token', 'eos_token', 'pad_token', 'unk_token'] if t in tokenizer.special_tokens_map}

    def encode(texts):
        dense, sparse = [None] * len(texts), [None] * len(texts)
        ids = tokenizer(texts, truncation=True, max_length=MAX_LENGTH)['input_ids']
        order = np.argsort([-len(x) for x in ids])     # by length, less padding (as FlagEmbedding)
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
            weights = np.maximum(hidden @ weight + bias, 0)
            for row, i in enumerate(batch):
                dense[i] = first[row].tolist()
                words = defaultdict(float)
                for w, token in zip(weights[row, :len(ids[i])], ids[i]):
                    if token not in unused and w > 0 and w > words[str(token)]:
                        words[str(token)] = float(w)
                sparse[i] = dict(words)
        return dense, sparse

lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def answer(self, status, body):
        data = json.dumps(body).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.answer(200, {'status': 'ok', 'device': 'cpu', 'variant': VARIANT})

    def do_POST(self):
        texts = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))['texts']
        started = time.time()
        with lock:
            dense, sparse = encode(texts)
        self.answer(200, {
            'dense': [[round(float(x), 6) for x in v] for v in dense],
            'sparse': [{str(t): round(float(w), 5) for t, w in s.items()} for s in sparse],
            'seconds': round(time.time() - started, 3),
        })

    def log_message(self, format, *args):
        pass


if __name__ == '__main__':
    print(f'{VARIANT} ready on 127.0.0.1:{PORT}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
