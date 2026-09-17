import { normalizeLine } from "./parser.ts";

function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function isCloserText(raw: string): boolean {
  const t = normalizeLine(raw.trim());
  const f = fold(t);
  if (/^[└]?\s*■$/.test(t) || f === "■" || f === "└■" || f === "└ ■") return true;
  if (f === "altfel") return true;
  if (/^pana cand\s+/.test(f)) return true;
  // `cât timp` fără `execută` = închizător de `repetă`
  if (/^cat timp\s+/.test(f) && !/executa\s*$/.test(f)) return true;
  return false;
}

function isOpenerText(raw: string): boolean {
  const f = fold(normalizeLine(raw.trim()));
  return /(atunci|executa)\s*$/.test(f) || f === "repeta" || f === "altfel";
}

/** Cel mai interior bloc neînchis înainte de linia `upto` (exclusiv). */
export function innermostOpen(lines: string[], upto: number): "block" | "repeta" | null {
  const stack: ("block" | "repeta")[] = [];
  for (let i = 0; i < upto && i < lines.length; i++) {
    if (/^\s*(\/\/|#)/.test(lines[i])) continue; // comentariu: ignorat
    const t = normalizeLine(lines[i].trim());
    if (!t) continue;
    const f = fold(t);
    if (/^[└]?\s*■$/.test(t) || f === "■" || f === "└■" || f === "└ ■") {
      if (stack[stack.length - 1] === "block") stack.pop();
      continue;
    }
    if (f === "altfel") continue;
    if (/^pana cand\s+/.test(f) || (/^cat timp\s+/.test(f) && !/executa\s*$/.test(f))) {
      if (stack[stack.length - 1] === "repeta") stack.pop();
      continue;
    }
    if (/(atunci|executa)\s*$/.test(f)) stack.push("block");
    else if (f === "repeta") stack.push("repeta");
  }
  return stack.length ? stack[stack.length - 1] : null;
}

/**
 * Ce inserează Tab pe linia goală `idx`: `■`-ul dedentat dacă acolo se
 * așteaptă un închizător, altfel `null` (= indent normal de 2 spații).
 * Reguli: niciodată la nivel 0, niciodată înaintea unui closer existent,
 * niciodată într-un `repetă` (ăla se închide cu `până când`, nu cu `■`),
 * la EOF doar dacă blocul are deja corp (nu imediat după opener).
 */
export function tabInsertCloser(src: string, idx: number): string | null {
  const lines = src.split("\n");
  const cur = lines[idx] ?? "";
  if (cur.trim() !== "") return null;
  const depths = estimateDepths(src);
  if ((depths[idx] ?? 0) <= 0) return null;
  if (innermostOpen(lines, idx) === "repeta") return null;
  let j = idx + 1;
  while (j < lines.length && lines[j].trim() === "") j++;
  if (j < lines.length) {
    if (isCloserText(lines[j])) return null;
    // Dedentul se vede spațial: pad-ul liniei următoare sub indentul logic curent.
    // (Estimatorul singur nu-l vede — fără closer, adâncimea logică rămâne.)
    const nextPad = lines[j].match(/^\s*/)?.[0] ?? "";
    const nextWidth = [...nextPad].reduce((n, c) => n + (c === "\t" ? 2 : 1), 0);
    if (nextWidth >= (depths[idx] ?? 0) * 2) return null;
  } else {
    let k = idx - 1;
    while (k >= 0 && lines[k].trim() === "") k--;
    if (k < 0) return null;
    if (isOpenerText(lines[k]) || isCloserText(lines[k])) return null;
  }
  const pad = cur.match(/^\s*/)?.[0] ?? "";
  const dedented = pad.length >= 2 ? pad.slice(0, -2) : "";
  return `${dedented}■`;
}
/**
 * Estimează adâncimea de indentare pentru FIECARE linie (inclusiv goale),
 * tolerant la cod invalid — folosit doar pentru ghidaje vizuale, nu la parsare.
 * Convenție: openerele (`atunci`/`execută`/`repetă`/`altfel`) indentează linia
 * următoare; closerele (`■`/`altfel`/`până când`/`cât timp` fără `execută`)
 * dedentează propria linie.
 */
export function estimateDepths(src: string): number[] {
  let depth = 0;
  return src.split("\n").map((raw) => {
    if (/^\s*(\/\/|#)/.test(raw)) return depth; // comentariu: nu schimbă nimic
    const t = normalizeLine(raw.trim());
    const f = fold(t);
    const isClose = /^[└]?\s*■$/.test(t) || f === "■" || f === "└■" || f === "└ ■";
    const isAlt = f === "altfel";
    const isPana = /^pana cand\s+.+/.test(f);
    const isCat = /^cat timp\s+.+/.test(f);
    const hasExecuta = /executa\s*$/.test(f);
    if (isClose || isAlt || isPana || (isCat && !hasExecuta)) {
      depth = Math.max(0, depth - 1);
    }
    const d = depth;
    const isOpener = /(atunci|executa)\s*$/.test(f) || f === "repeta" || isAlt;
    if (isOpener) depth++;
    return d;
  });
}
