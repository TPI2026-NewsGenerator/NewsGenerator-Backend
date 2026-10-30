# Which products the quantization turned into integers: MatMul left in fp32, MatMulInteger in int8,
# and among the MatMul of fp32 those between two activations (attention: Q.K and weights.V)
import os
import sys
import onnx

here = os.path.dirname(os.path.abspath(__file__))
for name in sys.argv[1:] or ['fp32', 'int8']:
    m = onnx.load(os.path.join(here, 'models', name, 'model.onnx'), load_external_data=False)
    weights = {i.name for i in m.graph.initializer}
    ops = {}
    for n in m.graph.node:
        if n.op_type in ('MatMul', 'MatMulInteger', 'DynamicQuantizeLinear', 'Gemm'):
            key = n.op_type + (' (weight)' if n.op_type == 'MatMul' and any(i in weights for i in n.input) else '')
            ops[key] = ops.get(key, 0) + 1
    print(name, ops)
    if name != 'fp32':
        print('  examples', [n.name for n in m.graph.node if n.op_type == 'MatMulInteger'][:12])
