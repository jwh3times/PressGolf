#!/bin/sh
# Runs the smoke flow, and once more if the first attempt fails.
#
# A hosted simulator can stall Maestro's own driver (for example
# "Timed out while requesting screenshot"), which fails a run the app had
# nothing to do with. A real regression fails both attempts. Every attempt
# keeps its own screenshots and log under $2/attempt-N for the artifact.
#
# Usage: sh .maestro/run.sh <device> <output-dir> <junit-file>
set -u
device="$1"
output="$2"
junit="$3"

for attempt in 1 2; do
  if maestro --device="$device" test \
    --format JUNIT --output "$junit" \
    --test-output-dir "$output/attempt-$attempt" \
    .maestro/smoke.yml; then
    exit 0
  fi
  echo "::warning title=Native smoke::Maestro attempt $attempt of 2 failed"
done
exit 1
