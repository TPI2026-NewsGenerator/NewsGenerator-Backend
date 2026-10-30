# bge-m3 in 8 bits for the processor: the ONNX file of the BAAI repo (fp32, its last hidden states and
# the dense vector) with its matrix products quantized "dynamically" by ONNX Runtime: the weights stored
# in int8, the activations quantized on the fly, the products done in integers (AVX-VNNI on the
# i5-12400T of the server). The table of the 250 002 words stays in fp32: it is read, not multiplied.
#   int8    one scale per matrix
#   int8pc  one scale per column of each matrix (finer, usually closer to fp32)
#   int8x   int8 without the second product of each feed-forward (output/dense): its input, after the
#           GELU of 4096 values, has outliers that one scale per batch flattens
# bench/int8/.venv/Scripts/python bench/int8/quantize.py  -> bench/int8/models/{int8,int8pc}/model.onnx
import os
import sys
import time

from onnxruntime.quantization import QuantType, quantize_dynamic

here = os.path.dirname(os.path.abspath(__file__))
# a copy of the onnx folder of the repo: ONNX refuses external data behind the links of the cache
source = os.path.join(here, 'models', 'fp32', 'model.onnx')

FFN_OUT = [f'/0/auto_model/encoder/layer.{layer}/output/dense/MatMul' for layer in range(24)]
for name, per_channel, excluded in [('int8', False, []), ('int8pc', True, []), ('int8x', False, FFN_OUT)]:
    if len(sys.argv) > 1 and name not in sys.argv[1:]:
        continue
    out = os.path.join(here, 'models', name)
    os.makedirs(out, exist_ok=True)
    started = time.time()
    quantize_dynamic(source, os.path.join(out, 'model.onnx'), weight_type=QuantType.QInt8,
                     per_channel=per_channel, op_types_to_quantize=['MatMul'], nodes_to_exclude=excluded,
                     use_external_data_format=True)
    size = sum(os.path.getsize(os.path.join(out, f)) for f in os.listdir(out))
    print(f'{name}: {size / 1e9:.2f} GB in {time.time() - started:.0f} s', flush=True)
