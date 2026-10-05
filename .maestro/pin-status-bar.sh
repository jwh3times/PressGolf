#!/bin/sh
# Pins the status bar to a fixed time, full battery and full signal, so the
# nightly's screenshots compare from one night to the next (#66).
#
# iOS uses the simulator's status bar override; Android uses System UI demo mode.
#
# Usage: sh .maestro/pin-status-bar.sh <ios|android> <device>
set -eu
platform="$1"
device="$2"

case "$platform" in
  ios)
    xcrun simctl status_bar "$device" override --time 9:41 --batteryState charged \
      --batteryLevel 100 --cellularBars 4 --wifiBars 3 --dataNetwork wifi
    ;;
  android)
    demo() { adb -s "$device" shell am broadcast -a com.android.systemui.demo -e command "$@" > /dev/null; }
    adb -s "$device" shell settings put global sysui_demo_allowed 1
    demo enter
    demo clock -e hhmm 0941
    demo battery -e level 100 -e plugged false
    demo network -e wifi show -e level 4 -e mobile show -e datatype none -e level 4
    demo notifications -e visible false
    ;;
  *)
    echo "Unknown platform: $platform (expected ios or android)" >&2
    exit 2
    ;;
esac
