#!/usr/bin/env bash
# Pętla powiadomień: przez LOOP_SECONDS co SLEEP sekund pobiera najnowszy stan repozytorium i uruchamia scripts/notify.mjs.
# Dzięki temu powiadomienie przychodzi po 1–2 minutach, a nie po ~30 (tyle potrafi opóźnić harmonogram GitHuba).
set -u
BRANCH="${BRANCH:-main}"
LOOP_SECONDS="${LOOP_SECONDS:-21000}"   # 350 min; limit zadania to 360 min
SLEEP="${SLEEP:-60}"
STATE_FILES="push-state.json push-subscriptions.json"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

sync_down() { git fetch -q --depth=1 origin "$BRANCH" && git reset -q --hard FETCH_HEAD; }

commit_state() {
  # shellcheck disable=SC2086
  [ -z "$(git status --porcelain $STATE_FILES)" ] && return 0
  # shellcheck disable=SC2086
  git add $STATE_FILES
  git commit -q -m "Powiadomienia: stan wysyłki"
  git push -q origin "HEAD:$BRANCH" && return 0
  # ktoś (aplikacja) wypchnął w międzyczasie: pobierz najnowsze i dołóż tylko nasz plik stanu (subskrypcje należą do aplikacji)
  cp push-state.json /tmp/push-state.mine.json
  sync_down || return 1
  cp /tmp/push-state.mine.json push-state.json
  [ -z "$(git status --porcelain push-state.json)" ] && return 0
  git add push-state.json
  git commit -q -m "Powiadomienia: stan wysyłki"
  git push -q origin "HEAD:$BRANCH" || { echo "::warning::Nie udało się zapisać stanu wysyłki"; sync_down; }
}

END=$(( $(date +%s) + LOOP_SECONDS ))
while :; do
  sync_down || echo "::warning::Nie udało się pobrać repozytorium, używam poprzedniej wersji"
  node scripts/notify.mjs || true
  commit_state || true
  [ "$(date +%s)" -ge "$END" ] && break
  sleep "$SLEEP"
  [ "$(date +%s)" -ge "$END" ] && break
done
echo "Koniec pętli."
