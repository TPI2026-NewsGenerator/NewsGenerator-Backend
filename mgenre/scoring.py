#
#  Author: Fabian Rostello
#  Date: 22.10.2026
#  File: scoring.py
#  Description: The log-probability a sequence-to-sequence model (mBART, mGENRE) gives each of some target texts
#               given a source sentence, and its own generation without a prefix tree; apart from server.py
#               so that selftest.py checks them on a small random model, nothing downloaded
#

import torch
from transformers.modeling_outputs import BaseModelOutput


def log_probabilities(model, tokenizer, source, targets, max_source=256):
    """sum of the log-probabilities of each target ("Title >> en") given the sentence, and its length in tokens.
    The target is what the model writes: the tokens of the title, then </s>, after a </s> (decoder_start_token_id
    of the model): the <s> the tokenizer puts first is left out, as in GENRE"""
    device = next(model.parameters()).device
    enc = tokenizer(source, return_tensors='pt', truncation=True, max_length=max_source).to(device)
    ids = [tokenizer(target).input_ids[1:] for target in targets]
    longest = max(len(row) for row in ids)
    pad = model.config.pad_token_id
    labels = torch.full((len(ids), longest), pad, dtype=torch.long)
    decoder_input = torch.full((len(ids), longest), pad, dtype=torch.long)
    decoder_input[:, 0] = model.config.decoder_start_token_id
    for i, row in enumerate(ids):
        labels[i, :len(row)] = torch.tensor(row)
        decoder_input[i, 1:len(row)] = torch.tensor(row[:-1])
    labels, decoder_input = labels.to(device), decoder_input.to(device)
    with torch.inference_mode():
        hidden = model.get_encoder()(input_ids=enc.input_ids, attention_mask=enc.attention_mask).last_hidden_state
        out = model(encoder_outputs=BaseModelOutput(last_hidden_state=hidden.expand(len(ids), -1, -1)),
                    attention_mask=enc.attention_mask.expand(len(ids), -1), decoder_input_ids=decoder_input)
        logp = out.logits.float().log_softmax(-1).gather(2, labels.unsqueeze(-1)).squeeze(-1)
    keep = torch.zeros_like(labels, dtype=torch.bool)
    for i, row in enumerate(ids):
        keep[i, :len(row)] = True
    return (logp * keep).sum(1).tolist(), keep.sum(1).tolist()


def generate(model, tokenizer, sources, beams, max_source=256):
    device = next(model.parameters()).device
    enc = tokenizer(sources, return_tensors='pt', padding=True, truncation=True, max_length=max_source).to(device)
    with torch.inference_mode():
        out = model.generate(**enc, num_beams=beams, num_return_sequences=beams, max_new_tokens=40,
                             output_scores=True, return_dict_in_generate=True)
    texts = tokenizer.batch_decode(out.sequences, skip_special_tokens=True)
    scores = out.sequences_scores.tolist()
    return [{'texts': texts[i * beams:(i + 1) * beams], 'scores': [round(s, 3) for s in scores[i * beams:(i + 1) * beams]]}
            for i in range(len(sources))]
