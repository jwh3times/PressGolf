#!/bin/sh
# Runs the smoke flow, and once more if the first attempt fails.
#
# A hosted simulator can stall Maestro's own driver (for example
# "Timed out while requesting screenshot"), which fails a run the app had
# nothing to do with. A real regression fails both attempts. Every attempt
# keeps its own screenshots and log under $2/attempt-N and its own JUnit
# report at $2/junit-attempt-N.xml, so a retry cannot overwrite the evidence.
#
# A failed attempt sets MAESTRO_ATTEMPT_FAILED=true for later workflow steps,
# so the output is kept even when the retry passes.
#
# Usage: sh .maestro/run.sh <device> <output-dir>
set -u
device="$1"
output="$2"

mkdir -p "$output"
for attempt in 1 2; do
  if maestro --device="$device" test \
    --format JUNIT --output "$output/junit-attempt-$attempt.xml" \
    --test-output-dir "$output/attempt-$attempt" \
    .maestro/smoke.yml; then
    exit 0
  fi
  echo "::warning title=Native smoke::Maestro attempt $attempt of 2 failed"
  if [ -n "${GITHUB_ENV:-}" ]; then
    echo "MAESTRO_ATTEMPT_FAILED=true" >> "$GITHUB_ENV"
  fi
done
exit 1
