#!/bin/sh
# Runs every journey flow, and each one once more if its first attempt fails.
#
# A hosted simulator can stall Maestro's own driver (for example
# "Timed out while requesting screenshot"), which fails a run the app had
# nothing to do with. A real regression fails both attempts. Every attempt
# keeps its own screenshots and log under $2/<flow>/attempt-N and its own
# JUnit report at $2/<flow>/junit-attempt-N.xml, so a retry cannot overwrite
# the evidence. A flow that fails twice fails the run, but the flows after it
# still run, so one regression does not hide another.
#
# A failed attempt sets MAESTRO_ATTEMPT_FAILED=true for later workflow steps,
# so the output is kept even when the retry passes.
#
# Usage: sh .maestro/run.sh <device> <output-dir>
# MAESTRO_FLOWS names another flows directory (the script tests use it).
set -u
device="$1"
output="$2"
flows="${MAESTRO_FLOWS:-.maestro/flows}"

mkdir -p "$output"
status=0
ran=0
for flow in "$flows"/*.yml; do
  [ -f "$flow" ] || continue
  ran=$((ran + 1))
  name="$(basename "$flow" .yml)"
  mkdir -p "$output/$name"
  passed=false
  for attempt in 1 2; do
    if maestro --device="$device" test \
      --format JUNIT --output "$output/$name/junit-attempt-$attempt.xml" \
      --test-output-dir "$output/$name/attempt-$attempt" \
      "$flow"; then
      passed=true
      break
    fi
    echo "::warning title=Native smoke::Maestro attempt $attempt of 2 failed: $name"
    if [ -n "${GITHUB_ENV:-}" ]; then
      echo "MAESTRO_ATTEMPT_FAILED=true" >> "$GITHUB_ENV"
    fi
  done
  [ "$passed" = true ] || status=1
done

if [ "$ran" -eq 0 ]; then
  echo "::error title=Native smoke::No flows found in $flows"
  exit 1
fi
exit "$status"
