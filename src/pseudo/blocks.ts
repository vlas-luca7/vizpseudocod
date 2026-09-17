import { normalizeLine } from "./parser.ts";

export type LineKind =
  | "openBlock" // `dacă…atunci` / `cât timp…execută` / `pentru…execută` (se închid cu ■)
  | "repeta" // `repetă` (se închide cu `până când` / `cât timp`)
  | "closeSq" // `■`
  | "repetaCloser" // `până când <cond>` / `cât timp <cond>` (fără `execută`)
  | "altfel"
  | "leaf";

function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Clasifică o linie canonică (fără prefixe grafice `┌`/`└`). */
export function classifyLine(raw: string): LineKind {
  const t = normalizeLine(raw.trim());
  const f = fold(t);
  if (/^[└]?\s*■$/.test(t) || f === "■" || f === "└■" || f === "└ ■") return "closeSq";
  if (f === "altfel") return "altfel";
  if (/^pana cand\s+/.test(f)) return "repetaCloser";
  if (/^cat timp\s+/.test(f)) {
    return /executa\s*$/.test(f) ? "openBlock" : "repetaCloser";
  }
  if (/^daca\s+.+\s+atunci$/.test(f)) return "openBlock";
  if (/^pentru\s+.+\s+executa$/.test(f)) return "openBlock";
  if (f === "repeta") return "repeta";
  return "leaf";
}

export interface BlockMap {
  /** opener idx → closer idx (pentru `dacă`/`cât timp`/`pentru`/`repetă`) */
  openToClose: Map<number, number>;
  /** closer idx → opener idx */
  closeToOpen: Map<number, number>;
  /** `altfel` idx → `■` idx al blocului părinte */
  altfelToClose: Map<number, number>;
}

/**
 * Hartă blocuri echilibrate pe linii canonice (parserul garantează
 * validitatea, deci fiecare opener are closer pereche).
 */
export function blockRanges(lines: string[]): BlockMap {
  const openToClose = new Map<number, number>();
  const closeToOpen = new Map<number, number>();
  const altfelToClose = new Map<number, number>();
  const stack: { idx: number; kind: "block" | "repeta" }[] = [];
  lines.forEach((raw, i) => {
    const k = classifyLine(raw);
    if (k === "openBlock") stack.push({ idx: i, kind: "block" });
    else if (k === "repeta") stack.push({ idx: i, kind: "repeta" });
    else if (k === "closeSq") {
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].kind === "block") {
          const [op] = stack.splice(s, 1);
          openToClose.set(op.idx, i);
          closeToOpen.set(i, op.idx);
          break;
        }
      }
    } else if (k === "repetaCloser") {
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].kind === "repeta") {
          const [op] = stack.splice(s, 1);
          openToClose.set(op.idx, i);
          closeToOpen.set(i, op.idx);
          break;
        }
      }
    } else if (k === "altfel") {
      const top = stack[stack.length - 1];
      if (top?.kind === "block") {
        // closerul se completează când se închide blocul; marcăm provizoriu
        altfelToClose.set(i, -1);
      }
    }
  });
  // leagă fiecare `altfel` de closerul blocului care îl conține
  for (const ai of altfelToClose.keys()) {
    for (const [o, c] of openToClose) {
      if (o < ai && ai < c) {
        altfelToClose.set(ai, c);
        break;
      }
    }
    if (altfelToClose.get(ai) === -1) altfelToClose.delete(ai);
  }
  return { openToClose, closeToOpen, altfelToClose };
}

/**
 * Intervalul care se mișcă la drag din poziția `idx`: blocul întreg
 * echilibrat pentru opener/closer, corpul else pentru `altfel`
 * (fără linia `altfel`, ca destinația să rămână validă), o linie
 * pentru frunze/comentarii.
 */
export function dragRange(lines: string[], idx: number): [number, number] {
  const map = blockRanges(lines);
  const k = classifyLine(lines[idx] ?? "");
  if (k === "openBlock" || k === "repeta") {
    const c = map.openToClose.get(idx);
    if (c !== undefined) return [idx, c];
  } else if (k === "closeSq" || k === "repetaCloser") {
    const o = map.closeToOpen.get(idx);
    if (o !== undefined) return [o, idx];
  } else if (k === "altfel") {
    const c = map.altfelToClose.get(idx);
    if (c !== undefined && idx + 1 <= c - 1) return [idx + 1, c - 1];
    return [idx, idx]; // else gol: mutarea e no-op prin moveLines
  }
  return [idx, idx];
}

/**
 * Mută intervalul tras din `from` la slotul `to`/`before`.
 * Întoarce liniile noi sau `null` dacă drop-ul e în interiorul
 * propriului interval (no-op, fără eroare).
 */
export function moveLines(
  lines: string[],
  from: number,
  to: number,
  before: boolean,
): string[] | null {
  if (from < 0 || from >= lines.length || to < 0 || to >= lines.length) return null;
  const [mFrom, mTo] = dragRange(lines, from);
  if (to >= mFrom && to <= mTo) return null;
  const len = mTo - mFrom + 1;
  // `altfel` cu else gol nu are ce muta
  if (classifyLine(lines[from] ?? "") === "altfel" && len === 1 && mFrom === from) {
    const map = blockRanges(lines);
    if (map.altfelToClose.has(from)) return null;
  }
  const block = lines.slice(mFrom, mTo + 1);
  const rest = lines.filter((_, i) => i < mFrom || i > mTo);
  let target = before ? to : to + 1;
  if (target > mTo) target -= len;
  rest.splice(target, 0, ...block);
  return rest;
}

/**
 * Ștergere la nivel de bloc: X pe opener/closer șterge blocul întreg
 * echilibrat, X pe `altfel` șterge doar ramura else, X pe frunză o linie.
 * Întoarce liniile rămase (fără să valideze — validarea rămâne la parser).
 */
export function deleteRange(lines: string[], idx: number): string[] {
  const map = blockRanges(lines);
  const k = classifyLine(lines[idx] ?? "");
  let from = idx;
  let to = idx;
  if (k === "openBlock" || k === "repeta") {
    const c = map.openToClose.get(idx);
    if (c !== undefined) to = c;
  } else if (k === "closeSq" || k === "repetaCloser") {
    const o = map.closeToOpen.get(idx);
    if (o !== undefined) {
      from = o;
      to = idx;
    }
  } else if (k === "altfel") {
    const c = map.altfelToClose.get(idx);
    if (c !== undefined) to = c - 1; // ramura else, fără ■-ul blocului
  }
  return lines.filter((_, i) => i < from || i > to);
}
