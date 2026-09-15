#!/bin/bash
# Final step: probes -> cleanup -> drop throwaway scripts -> push -> open PR.
cd /home/team/shared/site || exit 1
F=/tmp/final.log
: > "$F"
{
  echo "branch=$(git branch --show-current)"
  bash tmp-probe.sh > /dev/null 2>&1
  echo "probe.sh exit=$?  (results in /tmp/probe.log)"
  bun tmp-cleanup.ts > /tmp/cleanup.log 2>&1
  echo "cleanup exit=$?  (results in /tmp/cleanup.log)"
  rm -f tmp-probe.sh tmp-cleanup.ts
  git add -A
  git commit -q -m "chore(peer groups): drop throwaway probe scripts" 2>&1 | tail -2
  git status --short
  echo "--- push"
  git push -u origin feat/peer-groups-checkin-send 2>&1 | tail -4
  echo "--- pr"
  node -e '
  const fs = require("fs");
  const body = fs.readFileSync("/tmp/peercol_commitmsg.txt", "utf8");
  fs.writeFileSync("/tmp/pr.json", JSON.stringify({
    title: "feat(peer groups): phone-keyed check-ins + group send (BUILD A backend)",
    head: "feat/peer-groups-checkin-send",
    base: "main",
    body,
  }));
  '
  TOKEN=$(printf "protocol=https\nhost=github.com\n" | git credential fill | grep ^password= | cut -d= -f2)
  curl -s -X POST -H "Authorization: token $TOKEN" -H "Accept: application/vnd.github+json" \
    https://api.github.com/repos/jennmprcc-dot/SafeGround/pulls \
    --data-binary @/tmp/pr.json -o /tmp/pr-response.json
  node -e '
  const fs = require("fs");
  const r = JSON.parse(fs.readFileSync("/tmp/pr-response.json", "utf8"));
  console.log("PR:", r.number || r.errors || r.message, r.html_url || "");
  '
} >> "$F" 2>&1
echo DONE
