#!/usr/bin/env bash
# e2e: pseudocod → C++ → g++ → rulare cu stdin → compară stdout.
# Rulare: pnpm test:e2e (necesită g++).
set -euo pipefail
cd "$(dirname "$0")/.."
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
node --experimental-strip-types --no-warnings -e "
import('./tests/fixtures.ts').then(async ({ COMPLEX, COMPLEX_STDIN }) => {
  const { parse } = await import('./src/pseudo/parser.ts');
  const { emitCpp } = await import('./src/pseudo/emitter.ts');
  const fs = await import('node:fs');
  const r = parse(COMPLEX);
  if (!r.ok) { console.error(r.errors); process.exit(1); }
  fs.writeFileSync('$TMP/prog.cpp', emitCpp(r.ast, r.declared));
  fs.writeFileSync('$TMP/stdin.txt', COMPLEX_STDIN);
});"
g++ -std=c++17 -O2 -o "$TMP/prog" "$TMP/prog.cpp"
"$TMP/prog" < "$TMP/stdin.txt" > "$TMP/out.txt"
EXPECTED="$(node --experimental-strip-types --no-warnings -e "import('./tests/fixtures.ts').then(({COMPLEX_EXPECT}) => process.stdout.write(COMPLEX_EXPECT))")"
ACTUAL="$(cat "$TMP/out.txt")"
if [ "$ACTUAL" = "$EXPECTED" ]; then
  echo "ok - e2e: programul C++ generat compilează și afișează \"$ACTUAL\""
else
  echo "FAIL - e2e: așteptat \"$EXPECTED\", obținut \"$ACTUAL\""
  exit 1
fi
