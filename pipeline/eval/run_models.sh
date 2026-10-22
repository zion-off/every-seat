#!/usr/bin/env bash
# Runs every model on both labelled excerpts, RUNS times each, into pipeline/eval/runs.
# Run it from the repository root with the pipeline virtualenv's `everyseat` on PATH.
# A run that leaves problems open still writes its log, and counts as a failed run.
set -u

FILMS_DIR="${FILMS_DIR:-build/downloads}"
RUNS="${RUNS:-3}"
MODELS="${MODELS:-nova-pro nova-2-lite}"
OUT="pipeline/eval/runs"
export AWS_PROFILE="${AWS_PROFILE:-personal}" AWS_REGION="${AWS_REGION:-us-east-1}"

excerpt() { # name film-file title start duration
  local name=$1 film=$2 title=$3 start=$4 duration=$5 model run
  for model in $MODELS; do
    for run in $(seq 1 "$RUNS"); do
      echo "== $model run $run: $name"
      everyseat analyze "$FILMS_DIR/$film" --start "$start" --duration "$duration" \
        --title "$title" --name "$name" --model "$model" \
        --work-dir "build/work/eval/$name" --out-dir "$OUT/$model/$run" ||
        echo "(failed: $model run $run on $name)"
    done
  done
}

excerpt tears_of_steel_excerpt tears_of_steel_720p.mov tears-of-steel 420 90
excerpt elephants_dream_excerpt elephantsdream-720-h264-st-aac.mov elephants-dream 330 90
