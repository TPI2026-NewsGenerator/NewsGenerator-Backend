# NER bench: speed and entities of GLiNER on the sample (bench/data/ner/sample.json), on the processor
#   python bench.py <model> <threads> <out.json> [onnx file] [onnx repo]
# onnx repo: where the ONNX file is when the model's repo has none (onnx-community)
import json, os, shutil, sys, time, torch
from gliner import GLiNER
from huggingface_hub import hf_hub_download, snapshot_download
model_id, threads, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
onnx = sys.argv[4] if len(sys.argv) > 4 else None
onnx_repo = sys.argv[5] if len(sys.argv) > 5 else None
torch.set_num_threads(threads)
LABELS = ['person', 'organization', 'location']
t = time.time()
if onnx:
    folder = snapshot_download(model_id)
    if onnx_repo:
        local = f'/cache/local/{model_id.replace("/", "_")}'
        if not os.path.exists(local): shutil.copytree(folder, local)
        shutil.copy(hf_hub_download(onnx_repo, onnx), os.path.join(local, os.path.basename(onnx)))
        folder, onnx = local, os.path.basename(onnx)
    model = GLiNER.from_pretrained(folder, load_onnx_model=True, onnx_model_file=onnx, load_tokenizer=True)
    try:
        model.model.session.set_providers(['CPUExecutionProvider'])
    except Exception: pass
else:
    model = GLiNER.from_pretrained(model_id)
    if os.environ.get('QUANT'):
        model.model = torch.quantization.quantize_dynamic(model.model, {torch.nn.Linear}, dtype=torch.qint8)
print(f'loaded in {time.time() - t:.1f} s', flush=True)
rows = json.load(open('/data/sample.json'))
texts = [(r['text'].split('. ')[0] if os.environ.get('TITLE') else r['text'])[:int(os.environ.get('CHARS', '700'))] for r in rows]
model.batch_predict_entities(texts[:8], LABELS, threshold=0.5)
t = time.time()
found = []
for i in range(0, len(texts), 16):
    found += model.batch_predict_entities(texts[i:i + 16], LABELS, threshold=0.5)
spent = time.time() - t
print(f'{len(texts)} texts in {spent:.1f} s: {len(texts) / spent:.1f} texts/s with {threads} threads', flush=True)
json.dump([{**r, 'entities': [{'text': e['text'], 'label': e['label'], 'score': round(e['score'], 2)} for e in f]} for r, f in zip(rows, found)],
          open(out, 'w'), ensure_ascii=False, indent=1)
