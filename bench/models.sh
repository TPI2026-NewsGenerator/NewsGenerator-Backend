#!/usr/bin/env bash
# the five AI tasks of a briefing for one model, on the same data: bash bench/models.sh <model> [think]
# writes bench/models/<model>/*.txt; the candidates of the choice are frozen in bench/models/ by the first run
set -u
model=$1; think=${2:-}
out="bench/models/${model//:/_}${think:+-$think}"; mkdir -p "$out"
export OLLAMA_MODEL=$model
[ -n "$think" ] && export OLLAMA_THINK=$think
t() { local name=$1; shift; local start=$(date +%s); "$@" > "$out/$name.txt" 2>&1; echo "seconds $(( $(date +%s) - start ))" >> "$out/$name.txt"; }
t check node bench/check.mjs 2
t merge node bench/merge.mjs 2
SHOWN=40 t merge40 node bench/merge.mjs 1
TODAY_ONLY=1 t profile node bench/split-rule.mjs 2 bench/split-empty.txt
for user in 4 129 154; do FROZEN=bench/models/candidates-$user.json t select-$user node bench/select.mjs $user 1 titles; done
t review-154 node bench/review.mjs 154 16
t review-129 node bench/review.mjs 129 14
t review-4 node bench/review.mjs 4 1
echo "done $model $think"
