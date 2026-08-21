#!/usr/bin/env bash
# Type errors in the files THIS change touched — nothing else.
#
# WHY THIS EXISTS
#
# The API cannot be typechecked as a whole in the dev sandbox: the Prisma client
# is generated from the schema at build time, and where that generation is not
# possible the stub in node_modules is years out of date. It does not know
# StaffRole, Plan.featuresJson, Tenant.billingExempt or a hundred other real
# fields, so `tsc -p apps/api` reports over a thousand errors that are all lies.
#
# I let that drown a true one. A required field added to the PosSettings
# interface left one object literal incomplete, the error sat in the middle of
# the noise, I ran a grep too narrow to include it, and the deploy died on a
# one-line mistake that a typechecker had already found and told me about.
#
# So: run tsc, then show only the errors in files that differ from the branch
# this work started on. Those are the ones I am responsible for, and the list is
# short enough to read every line of rather than pattern-match.
#
#   ./scripts/check-changed-types.sh            # vs origin/main
#   ./scripts/check-changed-types.sh HEAD~3     # vs any ref
set -uo pipefail
cd "$(dirname "$0")/.."

BASE="${1:-origin/main}"

CHANGED=$(git diff --name-only "$BASE" -- '*.ts' '*.tsx' 2>/dev/null | sed 's|^|/|')
if [ -z "$CHANGED" ]; then
  echo "No TypeScript files changed vs $BASE."
  exit 0
fi

echo "Files changed vs $BASE:"
git diff --name-only "$BASE" -- '*.ts' '*.tsx' | sed 's/^/  /'
echo

FOUND=0
for PROJECT in apps/api apps/web; do
  OUT=$(npx tsc --noEmit -p "$PROJECT/tsconfig.json" 2>&1 || true)
  HITS=""
  while IFS= read -r file; do
    [ -z "$file" ] && continue
    MATCH=$(printf '%s\n' "$OUT" | grep -F "$file(" || true)
    [ -n "$MATCH" ] && HITS="${HITS}${MATCH}"$'\n'
  done <<< "$(git diff --name-only "$BASE" -- '*.ts' '*.tsx')"

  if [ -n "${HITS// /}" ]; then
    echo "=== $PROJECT — errors in files you changed ==="
    printf '%s' "$HITS"
    FOUND=1
  else
    echo "=== $PROJECT — clean ==="
  fi
done

echo
if [ "$FOUND" -eq 1 ]; then
  echo "FAIL: read every line above. Prisma-shaped errors may still be stub noise,"
  echo "      but anything else is real and will stop the deploy."
  exit 1
fi
echo "OK: no type errors in the files this change touched."
