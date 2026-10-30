# What the ONNX file of the BAAI repo gives (inputs, outputs), before quantizing it
import glob
import os
import onnx

snapshot = glob.glob(os.path.expanduser('~/.cache/huggingface/hub/models--BAAI--bge-m3/snapshots/*/'))[0]
m = onnx.load(os.path.join(snapshot, 'onnx', 'model.onnx'), load_external_data=False)
dims = lambda t: [d.dim_param or d.dim_value for d in t.type.tensor_type.shape.dim]
print('inputs', [(i.name, dims(i)) for i in m.graph.input])
print('outputs', [(o.name, dims(o)) for o in m.graph.output])
print('opset', [(o.domain, o.version) for o in m.opset_import], 'nodes', len(m.graph.node))
print('last nodes', [(n.op_type, list(n.input)[:2], list(n.output)) for n in m.graph.node[-8:]])
