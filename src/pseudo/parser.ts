export type TipVar = "natural" | "intreg" | "real";

export type Stmt =
  | { kind: "atribuire"; var: string; expr: string; line: number }
  | { kind: "citeste"; vars: string[]; tip: TipVar; adnotare: string | null; line: number }
  | { kind: "scrie"; vars: string[]; line: number }
  | { kind: "comentariu"; text: string; line: number }
  | { kind: "daca"; cond: string; then: Stmt[]; alt: Stmt[] | null; line: number }
  | { kind: "catTimp"; cond: string; body: Stmt[]; line: number }
  | {
      kind: "pentru";
      v: string;
      start: string;
      stop: string;
      pas: string | null;
      body: Stmt[];
      line: number;
    }
  | { kind: "repeta"; body: Stmt[]; inchidere: "pana" | "cat"; cond: string; line: number };

export interface ParseOk {
  ok: true;
  ast: Stmt[];
  declared: { name: string; tip: TipVar }[];
  canonical: string;
  /** Câte blocuri a închis automat parserul la EOF (■-uri fantomă, doar vizual). */
  autoClosed: number;
}
export interface ParseErr {
  ok: false;
  errors: { line: number; msg: string }[];
}
export type ParseResult = ParseOk | ParseErr;

export const VAR_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

const TIP_CUVANT: Record<string, TipVar> = {
  "număr natural": "natural",
  "număr întreg": "intreg",
  "număr real": "real",
};

function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Normalizează o linie la forma canonică de potrivire (păstrează case-ul variabilelor separat). */
export function normalizeLine(raw: string): string {
  let s = raw;
  if (s.includes(":=")) return s; // lăsăm pentru eroare explicită
  s = s.replace(/<-/g, "←");
  s = s.replace(/<=/g, "≤").replace(/>=/g, "≥");
  s = s.replace(/==/g, "=").replace(/!=/g, "≠").replace(/<>/g, "≠");
  // underscore doar în keywords cunoscute (nu în nume de variabile)
  s = s
    .replace(/cât_timp/gi, "cât timp")
    .replace(/cat_timp/gi, "cat timp")
    .replace(/până_când/gi, "până când")
    .replace(/pana_cand/gi, "pana cand")
    .replace(/număr_natural/gi, "număr natural")
    .replace(/numar_natural/gi, "numar natural")
    .replace(/număr_întreg/gi, "număr întreg")
    .replace(/numar_intreg/gi, "numar intreg")
    .replace(/număr_real/gi, "număr real")
    .replace(/numar_real/gi, "numar real")
    .replace(/numere_naturale/gi, "numere naturale")
    .replace(/numere_întregi/gi, "numere întregi")
    .replace(/numere_intregi/gi, "numere intregi")
    .replace(/numere_reale/gi, "numere reale");
  // `si` izolat → `și` (doar când e cuvânt separat, nu în variabile)
  s = s.replace(/(^|[\s(),])si([\s(),]|$)/gi, "$1și$2");
  s = s.replace(/\s+/g, " ").trim();
  // mapează formele fără diacritice la canonic (doar keywords, case-insensitive)
  const rep: [RegExp, string][] = [
    [/^citeste\b/i, "citește"],
    [/\bciteste\b/gi, "citește"],
    [/^scrie\b/i, "scrie"],
    [/\bdaca\b/gi, "dacă"],
    [/\batunci\b/gi, "atunci"],
    [/\baltfel\b/gi, "altfel"],
    [/\bcat timp\b/gi, "cât timp"],
    [/\bexecuta\b/gi, "execută"],
    [/\brepeta\b/gi, "repetă"],
    [/\bpana cand\b/gi, "până când"],
    [/\bnumar naturala?\b/gi, "număr natural"],
    [/\bnumar intreg\b/gi, "număr întreg"],
    [/\bnumar real\b/gi, "număr real"],
    [/\bnumar întreg\b/gi, "număr întreg"],
    [/\bnumere naturale\b/gi, "număr natural"],
    [/\bnumere reale\b/gi, "număr real"],
    [/\bnumere întregi\b/gi, "număr întreg"],
    [/\bnumere intregi\b/gi, "număr întreg"],
  ];
  for (const [re, to] of rep) s = s.replace(re, to);
  return s;
}

function varsInExpr(expr: string): string[] {
  const curatat = expr
    .replace(/și/gi, " ")
    .replace(/sau/gi, " ")
    .replace(/nu/gi, " ")
    .replace(/[≤≥≠←]/g, " ")
    .replace(/[^A-Za-z0-9_ ]/g, " ");
  return curatat.split(/\s+/).filter((t) => VAR_RE.test(t) && isNaN(Number(t)));
}

function exprValid(expr: string): string | null {
  if (!expr.trim()) return "expresie goală";
  if (/\^/.test(expr)) return "operatorul `^` nu e permis în v1 (folosește `*`)";
  if (/\bdiv\b/i.test(expr) || /\bmod\b/i.test(expr))
    return "`div`/`mod` nu sunt permise în v1 (folosește `/` și `%`)";
  const openP = (expr.match(/\(/g) || []).length;
  const closeP = (expr.match(/\)/g) || []).length;
  if (openP !== closeP) return "paranteze neechilibrate";
  const openB = (expr.match(/\[/g) || []).length;
  const closeB = (expr.match(/\]/g) || []).length;
  if (openB !== closeB) return "`[ ]` neechilibrate";
  if (/[+\-*/%]{2,}/.test(expr.replace(/\s+/g, "")) && !/\(-/.test(expr)) {
    // permite `-1`, `(-x)`, dar nu `++`, `**`
    if (!/^\s*-/.test(expr)) {
      const compact = expr.replace(/\s+/g, "");
      if (/\+\+|--|\*\*|\/\/|%%/.test(compact)) return "operatori lipiți invalizi";
    }
  }
  if (!/[A-Za-z0-9)\]]/.test(expr)) return "expresie invalidă";
  return null;
}

/** `true` dacă segmentul e instrucțiune de bloc (trebuie singură pe linie). */
function isBlockish(f: string): boolean {
  if (/^[└]?\s*■$/.test(f) || f === "■" || f === "└■") return true;
  if (f === "altfel" || f === "repeta") return true;
  return /^(daca|pentru|pana cand|cat timp)\b/.test(f);
}

export function parse(source: string): ParseResult {
  const errors: { line: number; msg: string }[] = [];
  const rawLines = source.split("\n");
  // linii semnificative (ignorăm goale, păstrăm nr. linie original).
  // `;` desparte instrucțiuni SIMPLE pe aceeași linie fizică (`multi`),
  // expandate la canonic câte una pe linie.
  const lines: { n: number; s: string; multi: boolean; comment: boolean }[] = [];
  rawLines.forEach((r, i) => {
    const t = r.trim();
    if (!t) return;
    // comentariu pe linie proprie: text brut păstrat, fără split pe `;`, fără verificare `:=`
    if (t.startsWith("//") || t.startsWith("#")) {
      lines.push({ n: i + 1, s: t, multi: false, comment: true });
      return;
    }
    if (r.includes(":=")) {
      errors.push({ line: i + 1, msg: "`:=` nu e permis — folosește `←` (sau `<-`)" });
      return;
    }
    const segs = t
      .split(";")
      .map((x) => x.trim())
      .filter(Boolean);
    const multi = segs.length > 1;
    for (const g of segs) lines.push({ n: i + 1, s: normalizeLine(g), multi, comment: false });
  });

  const declared = new Map<string, TipVar>();
  const order: { name: string; tip: TipVar }[] = [];
  const declare = (name: string, tip: TipVar) => {
    const old = declared.get(name);
    if (old && old !== tip) {
      errors.push({ line: -1, msg: `variabila \`${name}\` redeclarată cu alt tip` });
      return;
    }
    if (!old) {
      declared.set(name, tip);
      order.push({ name, tip });
    }
  };
  const checkUse = (expr: string, ln: number) => {
    for (const v of varsInExpr(expr)) {
      if (!declared.has(v)) {
        // excepție: membrul stâng al atribuirii curente e declarat implicit mai jos
        errors.push({
          line: ln,
          msg: `variabila \`${v}\` folosită înainte de \`citește\`/atribuire`,
        });
      }
    }
  };

  interface Frame {
    stmts: Stmt[];
    closer:
      | null
      | { type: "daca"; node: Extract<Stmt, { kind: "daca" }>; inAlt: boolean }
      | { type: "catTimp"; node: Extract<Stmt, { kind: "catTimp" }> }
      | { type: "pentru"; node: Extract<Stmt, { kind: "pentru" }> }
      | { type: "repeta"; node: Extract<Stmt, { kind: "repeta" }> };
    openLine: number;
  }
  const root: Stmt[] = [];
  const stack: Frame[] = [{ stmts: root, closer: null, openLine: 0 }];
  const cur = () => stack[stack.length - 1];
  const pushStmt = (st: Stmt) => {
    const f = cur();
    if (f.closer?.type === "daca") {
      if (f.closer.inAlt) f.closer.node.alt!.push(st);
      else f.closer.node.then.push(st);
      return;
    }
    if (
      f.closer?.type === "catTimp" ||
      f.closer?.type === "pentru" ||
      f.closer?.type === "repeta"
    ) {
      (f.closer.node as unknown as { body: Stmt[] }).body.push(st);
      return;
    }
    f.stmts.push(st);
  };
  const pushScope = (frame: Frame) => stack.push(frame);

  const condValid = (c: string, ln: number): boolean => {
    if (!c.trim()) {
      errors.push({ line: ln, msg: "lipsește condiția" });
      return false;
    }
    const e = exprValid(c);
    if (e) {
      errors.push({ line: ln, msg: `condiție invalidă: ${e}` });
      return false;
    }
    return true;
  };

  for (const { n, s, multi, comment } of lines) {
    if (comment) {
      pushStmt({ kind: "comentariu", text: s, line: n });
      continue;
    }
    const f = fold(s);
    if (multi && isBlockish(f)) {
      errors.push({
        line: n,
        msg: "instrucțiunile de bloc (`dacă`/`cât timp`/`pentru`/`repetă`/`până când`/`altfel`/`■`) stau singure pe linie — `;` e doar între instrucțiuni simple",
      });
      continue;
    }
    // terminator ■
    if (/^[└]?\s*■$/.test(s) || f === "■" || f === "└■") {
      const top = stack[stack.length - 1];
      if (!top.closer || top.closer.type === "repeta") {
        errors.push({ line: n, msg: "`■` fără bloc deschis (`dacă`/`cât timp`/`pentru`)" });
        continue;
      }
      const node = top.closer.type === "daca" ? top.closer.node : (top.closer.node as Stmt);
      stack.pop();
      pushStmt(node);
      continue;
    }
    // altfel
    if (f === "altfel") {
      const top = cur();
      if (top.closer?.type !== "daca") {
        errors.push({ line: n, msg: "`altfel` fără `dacă`" });
        continue;
      }
      if (top.closer.inAlt) {
        errors.push({ line: n, msg: "un singur `altfel` per `dacă`" });
        continue;
      }
      top.closer.inAlt = true;
      top.closer.node.alt = [];
      continue;
    }
    // până când (închide repetă)
    let m = s.match(/^până când\s+(.+)$/i);
    if (m) {
      const top = cur();
      if (top.closer?.type !== "repeta") {
        errors.push({ line: n, msg: "`până când` fără `repetă`" });
        continue;
      }
      const cond = m[1].trim();
      if (condValid(cond, n)) checkUse(cond, n);
      top.closer.node.inchidere = "pana";
      top.closer.node.cond = cond;
      const closed = top.closer.node;
      stack.pop();
      pushStmt(closed);
      continue;
    }
    // repetă
    if (f === "repeta") {
      const node: Stmt = { kind: "repeta", body: [], inchidere: "pana", cond: "", line: n };
      pushScope({
        stmts: [],
        closer: { type: "repeta", node: node as Extract<Stmt, { kind: "repeta" }> },
        openLine: n,
      });
      continue;
    }
    // dacă
    m = s.match(/^dacă\s+(.+)\s+atunci$/i);
    if (m) {
      const cond = m[1].trim();
      if (condValid(cond, n)) checkUse(cond, n);
      const node = { kind: "daca", cond, then: [], alt: null, line: n } as Extract<
        Stmt,
        { kind: "daca" }
      >;
      pushScope({ stmts: [], closer: { type: "daca", node, inAlt: false }, openLine: n });
      continue;
    }
    if (fold(s).startsWith("daca ")) {
      errors.push({ line: n, msg: "lipsește `atunci` (forma: `dacă <cond> atunci`)" });
      continue;
    }
    // pentru
    m = s.match(
      /^pentru\s+([A-Za-z][A-Za-z0-9_]*)\s*←\s*(.+?)\s*,\s*(.+?)(?:\s*,\s*(.+?))?\s+execută$/i,
    );
    if (m) {
      const [, v, start, stop, pas] = m;
      for (const e of [start, stop]) {
        const bad = exprValid(e);
        if (bad) errors.push({ line: n, msg: `expresie invalidă în \`pentru\`: ${bad}` });
      }
      if (pas !== undefined) {
        if (!/^-?\d+$/.test(pas.trim()) || Number(pas.trim()) === 0) {
          errors.push({ line: n, msg: "pasul la `pentru` trebuie să fie constantă întreagă ≠ 0" });
          continue;
        }
      }
      declare(v, "intreg");
      const node = {
        kind: "pentru",
        v,
        start: start.trim(),
        stop: stop.trim(),
        pas: pas?.trim() ?? null,
        body: [],
        line: n,
      } as Extract<Stmt, { kind: "pentru" }>;
      pushScope({ stmts: [], closer: { type: "pentru", node }, openLine: n });
      continue;
    }
    if (fold(s).startsWith("pentru ")) {
      errors.push({ line: n, msg: "forma: `pentru <var> ← <start>, <stop> [, <pas>] execută`" });
      continue;
    }
    // cât timp ... execută (header)
    m = s.match(/^cât timp\s+(.+)\s+execută$/i);
    if (m) {
      const cond = m[1].trim();
      if (condValid(cond, n)) checkUse(cond, n);
      const node = { kind: "catTimp", cond, body: [], line: n } as Extract<
        Stmt,
        { kind: "catTimp" }
      >;
      pushScope({ stmts: [], closer: { type: "catTimp", node }, openLine: n });
      continue;
    }
    // cât timp <cond> (închidere repetă varianta 2 — fără `execută`)
    m = s.match(/^cât timp\s+(.+)$/i);
    if (m) {
      const top = cur();
      if (top.closer?.type === "repeta") {
        const cond = m[1].trim();
        if (condValid(cond, n)) checkUse(cond, n);
        top.closer.node.inchidere = "cat";
        top.closer.node.cond = cond;
        const closed2 = top.closer.node;
        stack.pop();
        pushStmt(closed2);
      } else {
        errors.push({ line: n, msg: "lipsește `execută` (forma: `cât timp <cond> execută`)" });
      }
      continue;
    }
    // citește (tipul poate avea adnotare indicativă: `număr natural nenul`)
    m = s.match(/^citește\s+(.+?)(?:\s*\(([^)]+)\))?$/i);
    if (m && fold(s).startsWith("citeste")) {
      const tipRaw = normalizeLine(m[2] ?? "număr natural").trim();
      const tipMatch = tipRaw.match(/^(număr natural|număr întreg|număr real)\b\s*(.*)$/i);
      if (!tipMatch) {
        errors.push({
          line: n,
          msg: "tip invalid — permis: `număr natural`, `număr întreg`, `număr real` (cu adnotare opțională)",
        });
        continue;
      }
      const tip: TipVar =
        fold(tipMatch[1]) === fold("număr natural")
          ? "natural"
          : fold(tipMatch[1]) === fold("număr întreg")
            ? "intreg"
            : "real";
      const adnotare = tipMatch[2].trim() ? tipMatch[2].trim() : null;
      void TIP_CUVANT;
      const vars = m[1]
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      if (!vars.length || vars.some((v) => !VAR_RE.test(v))) {
        errors.push({ line: n, msg: "forma: `citește a[, b] (număr întreg)`" });
        continue;
      }
      for (const v of vars) declare(v, tip);
      pushStmt({ kind: "citeste", vars, tip, adnotare, line: n });
      continue;
    }
    // scrie (doar variabile)
    if (fold(s).startsWith("scrie")) {
      const rest = s.replace(/^scrie\s*/i, "").trim();
      const vars = rest
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      if (!vars.length || vars.some((v) => !VAR_RE.test(v))) {
        errors.push({
          line: n,
          msg: "`scrie` acceptă doar variabile: `scrie a[, b]` (fără expresii/stringuri în v1)",
        });
        continue;
      }
      for (const v of vars)
        if (!declared.has(v))
          errors.push({
            line: n,
            msg: `variabila \`${v}\` folosită înainte de \`citește\`/atribuire`,
          });
      pushStmt({ kind: "scrie", vars, line: n });
      continue;
    }
    // atribuire
    m = s.match(/^([A-Za-z][A-Za-z0-9_]*)\s*←\s*(.+)$/);
    if (m) {
      const [, v, expr] = m;
      const bad = exprValid(expr.trim());
      if (bad) {
        errors.push({ line: n, msg: `expresie invalidă: ${bad}` });
        continue;
      }
      const rhsVars = varsInExpr(expr).filter((x) => x !== v);
      for (const u of rhsVars)
        if (!declared.has(u))
          errors.push({
            line: n,
            msg: `variabila \`${u}\` folosită înainte de \`citește\`/atribuire`,
          });
      if (!declared.has(v)) declare(v, "intreg"); // default int
      pushStmt({ kind: "atribuire", var: v, expr: expr.trim(), line: n });
      continue;
    }
    errors.push({
      line: n,
      msg: "linie nerecunoscută — verifică keywords (`dacă/atunci/altfel/cât timp/execută/repetă/până când/pentru/citește/scrie`)",
    });
  }

  // blocuri neînchise la EOF: ■ e auto-adăugat → valid (conform syntax.txt), mai puțin `repetă`
  let autoClosed = 0;
  while (stack.length > 1) {
    const top = stack[stack.length - 1];
    if (top.closer?.type === "repeta") {
      errors.push({
        line: top.openLine,
        msg: "`repetă` fără închidere (`până când <cond>` / `cât timp <cond>`)",
      });
      stack.pop();
      continue;
    }
    const unclosed =
      top.closer!.type === "daca"
        ? (top.closer as { node: Stmt }).node
        : (top.closer!.node as Stmt);
    stack.pop();
    pushStmt(unclosed);
    autoClosed++;
  }

  const fatal = errors.filter((e) => e.line !== -1);
  if (fatal.length) return { ok: false, errors: fatal };
  const typeErr = errors.find((e) => e.line === -1);
  if (typeErr) return { ok: false, errors: [{ line: 1, msg: typeErr.msg }] };

  return { ok: true, ast: root, declared: order, canonical: toCanonical(root), autoClosed };
}

export function toCanonical(ast: Stmt[], indent = ""): string {
  const out: string[] = [];
  for (const st of ast) {
    switch (st.kind) {
      case "atribuire":
        out.push(`${indent}${st.var} ← ${st.expr}`);
        break;
      case "citeste": {
        const tip =
          st.tip === "natural"
            ? "număr natural"
            : st.tip === "intreg"
              ? "număr întreg"
              : "număr real";
        out.push(
          `${indent}citește ${st.vars.join(", ")} (${tip}${st.adnotare ? ` ${st.adnotare}` : ""})`,
        );
        break;
      }
      case "comentariu":
        out.push(`${indent}${st.text}`);
        break;
      case "scrie":
        out.push(`${indent}scrie ${st.vars.join(", ")}`);
        break;
      case "daca":
        out.push(`${indent}dacă ${st.cond} atunci`);
        out.push(toCanonical(st.then, indent + "  "));
        if (st.alt) {
          out.push(`${indent}altfel`);
          out.push(toCanonical(st.alt, indent + "  "));
        }
        out.push(`${indent}■`);
        break;
      case "catTimp":
        out.push(`${indent}cât timp ${st.cond} execută`);
        out.push(toCanonical(st.body, indent + "  "));
        out.push(`${indent}■`);
        break;
      case "pentru":
        out.push(
          `${indent}pentru ${st.v} ← ${st.start}, ${st.stop}${st.pas ? `, ${st.pas}` : ""} execută`,
        );
        out.push(toCanonical(st.body, indent + "  "));
        out.push(`${indent}■`);
        break;
      case "repeta":
        out.push(`${indent}repetă`);
        out.push(toCanonical(st.body, indent + "  "));
        out.push(`${indent}${st.inchidere === "pana" ? "până când" : "cât timp"} ${st.cond}`);
        break;
    }
  }
  return out.filter(Boolean).join("\n");
}
