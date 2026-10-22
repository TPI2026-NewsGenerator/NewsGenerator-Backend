#
#  Author: Fabian Rostello
#  Date: 22.10.2026
#  File: selftest.py
#  Description: scoring.py on a small random mBART and a toy tokenizer (nothing downloaded): the log-probability
#               of a target is the one the model itself computes as its loss (labels shifted right), the same
#               alone or in a batch of targets of other lengths, and the int8 model answers
#   python mgenre/selftest.py
#

import copy

import torch
from transformers import BatchEncoding, MBartConfig, MBartForConditionalGeneration

from scoring import log_probabilities

torch.manual_seed(0)
VOCAB = 100


class ToyTokenizer:
    """<s> (0) ... </s> (2) around the characters of a text, as the tokenizer of mGENRE puts them"""

    def __call__(self, text, return_tensors=None, truncation=False, max_length=None, padding=False):
        if isinstance(text, list):
            rows = [self(item).input_ids for item in text]
            width = max(len(row) for row in rows)
            ids = torch.tensor([row + [1] * (width - len(row)) for row in rows])
            return BatchEncoding({'input_ids': ids, 'attention_mask': (ids != 1).long()})
        ids = [0] + [3 + ord(c) % 90 for c in text][:(max_length or 10 ** 6) - 2] + [2]
        if return_tensors == 'pt':
            tensor = torch.tensor([ids])
            return BatchEncoding({'input_ids': tensor, 'attention_mask': torch.ones_like(tensor)})
        return BatchEncoding({'input_ids': ids})


config = MBartConfig(vocab_size=VOCAB, d_model=32, encoder_layers=2, decoder_layers=2, encoder_attention_heads=4,
                     decoder_attention_heads=4, encoder_ffn_dim=64, decoder_ffn_dim=64, max_position_embeddings=64,
                     pad_token_id=1, bos_token_id=0, eos_token_id=2, decoder_start_token_id=2, dropout=0.0)
model = MBartForConditionalGeneration(config).eval()
tokenizer = ToyTokenizer()
source = '[START] OL [END] a gagné'
targets = ['Olympique Lyonnais >> en', 'Open Library >> en', 'OL >> fr']


def reference(target):
    """the loss of the model itself on this target: labels the tokens and </s>, the decoder input shifted right"""
    labels = torch.tensor([tokenizer(target).input_ids[1:]])
    enc = tokenizer(source, return_tensors='pt')
    with torch.inference_mode():
        out = model(input_ids=enc.input_ids, attention_mask=enc.attention_mask, labels=labels)
    return -out.loss.item() * labels.shape[1], labels.shape[1]


sums, lengths = log_probabilities(model, tokenizer, source, targets)
for target, total, length in zip(targets, sums, lengths):
    expected, expected_length = reference(target)
    assert length == expected_length, (target, length, expected_length)
    assert abs(total - expected) < 1e-3, (target, total, expected)
    alone, _ = log_probabilities(model, tokenizer, source, [target])
    assert abs(alone[0] - total) < 1e-3, (target, alone[0], total)
print('sum of log-probabilities = the loss of the model, alone or in a batch:', [round(s, 3) for s in sums])

quantized = copy.deepcopy(model)
torch.ao.quantization.quantize_dynamic(quantized.model, {torch.nn.Linear}, dtype=torch.qint8, inplace=True)
assert type(quantized.model.encoder.layers[0].fc1) is not torch.nn.Linear, 'the layers were not quantized'
assert type(quantized.lm_head) is torch.nn.Linear, 'the output layer must stay as it is'
int8_sums, _ = log_probabilities(quantized, tokenizer, source, targets)
assert all(isinstance(value, float) for value in int8_sums)
print('int8 answers:', [round(s, 3) for s in int8_sums])
print('selftest ok')
