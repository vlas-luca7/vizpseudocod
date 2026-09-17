# vizpseudocod

Editor web (React + Vite + TS + pnpm, fără backend) pentru pseudocod model BAC:
stânga pseudocod (moduri blocuri/cod), dreapta C++ echivalent read-only.
Persistență localStorage + share prin `#c=` base64url. Fără execuție.

**Sursa de adevăr pentru gramatică este `syntax.txt`** (dicționar înghețat v1).
Orice schimbare de sintaxă/validare/conversie începe de acolo și se
propagă în cod + teste. Nu inventa constructe în afara lui, și notifică la orice schimbare.

## Componente

- `src/pseudo/parser.ts` — normalizare alias-uri + parser pe linii → AST + erori în română
- `src/pseudo/emitter.ts` — AST → C++ Allman (`negateCond` cu flip de semn)
- `src/pseudo/indent.ts` — euristică vizuală (`estimateDepths`, `tabInsertCloser`, `innermostOpen`)
- `src/pseudo/blocks.ts` — operații structurale pe linii canonice (`deleteRange`)
- `src/pseudo/share.ts` — encode/decode `#c=`; `src/pseudo/example.ts` — exemplul demo
- `src/editor/CodeEditor.tsx` — textarea cu overlay (gutter, ghidaje, `■` fantomă, auto-insert la Enter, Tab=`■`)
- `src/editor/CppView.tsx` — vizualizare C++ numerotată; `src/App.tsx` — moduri, auto-regen (blocuri instant / cod debounce 700ms), paletă DnD
- `tests/regression.ts` — regresii (`pnpm test:regression`); `tests/fixtures.ts`, `tests/e2e.sh` (compilează C++ cu g++)

## Comenzi

`pnpm dev` · `pnpm build` · `pnpm lint` (oxlint, warning-urile react/set-state sunt intenționate) · `pnpm test` (regresii + e2e) · formatare `pnpm exec oxfmt --write src tests`

## Convenții

- Forma canonică: câte o instrucțiune pe linie, keywords mici cu diacritice, `← ≤ ≥ ≠`. Parserul ignoră indentarea; `■` lipsă la EOF e auto-închis (valid).
