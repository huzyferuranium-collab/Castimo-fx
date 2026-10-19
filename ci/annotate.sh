#!/usr/bin/env bash
# Runs a command and, if it fails, turns the output into a GitHub annotation so the
# error text is visible in the checks UI and through the GitHub API.
#
# usage: ci/annotate.sh "<title>" <command...>
# env:   ANNOTATE_MODE=head  -> annotate the first lines instead of the last lines
set -o pipefail

title="$1"
shift

out="$(mktemp)"
"$@" 2>&1 | tee "$out"
code="${PIPESTATUS[0]}"

if [ "$code" -ne 0 ]; then
  if [ "${ANNOTATE_MODE:-tail}" = "head" ]; then
    picked="$(sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g' "$out" | head -n 60)"
  else
    picked="$(sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g' "$out" | tail -n 60)"
  fi
  # GitHub annotation encoding: escape %, CR and LF.
  msg="$(printf '%s' "$picked" | head -c 3500 | sed -e 's/%/%25/g' -e 's/\r//g' | awk '{printf "%s%%0A", $0}')"
  echo "::error title=${title} failed::${msg}"
fi

exit "$code"
