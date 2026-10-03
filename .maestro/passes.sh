#!/bin/sh
# Runs the journey flows twice: at the default text size, then at the largest
# the platform offers, where a control pushed off-screen or out of reach fails
# its flow. The large-text pass runs even when the default pass failed, and
# the text size goes back to the default afterwards.
#
# Output: $3/default and $3/large-text, each laid out as run.sh describes.
#
# Usage: sh .maestro/passes.sh <ios|android> <device> <output-dir>
set -u
platform="$1"
device="$2"
output="$3"
here="$(dirname "$0")"

case "$platform" in
  ios)
    large() { xcrun simctl ui "$device" content_size accessibility-extra-extra-extra-large; }
    reset() { xcrun simctl ui "$device" content_size large; }
    ;;
  android)
    large() { adb -s "$device" shell settings put system font_scale 2.0; }
    reset() { adb -s "$device" shell settings put system font_scale 1.0; }
    ;;
  *)
    echo "Unknown platform: $platform (expected ios or android)" >&2
    exit 2
    ;;
esac

status=0
sh "$here/run.sh" "$device" "$output/default" || status=1
large
sh "$here/run.sh" "$device" "$output/large-text" || status=1
reset
exit "$status"
