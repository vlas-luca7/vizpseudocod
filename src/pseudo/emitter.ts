import type { Stmt, TipVar } from "./parser";

const TIP_CPP: Record<TipVar, string> = {
  natural: "unsigned int",
  intreg: "int",
  real: "double",
};

function exprCpp(expr: string): string {
  // protejează operatorii compuși prin placeholderi
  let s = expr;
  s = s.replace(/≤/g, "§LE§").replace(/≥/g, "§GE§").replace(/≠/g, "§NE§");
  s = s.replace(/==/g, "=");
  // `=` izolat (comparație) → `==`, dar nu în `<= >= != ==`
  s = s.replace(/(?<![<>=!])=(?![=])/g, "==");
  s = s
    .replace(/§LE§/g, "<=")
    .replace(/§GE§/g, ">=")
    .replace(/§NE§/g, "!=");
  s = s
    .replace(/\bși\b/gi, "&&")
    .replace(/\bsi\b/gi, "&&")
    .replace(/\bsau\b/gi, "||")
    .replace(/\bnu\b/gi, "!")
    .replace(/!\s+\(/g, "!(");
  // `[expr]` → `expr` (fără cast — `/` pe întregi trunchiază deja)
  s = s.replace(/\[\s*([^\[\]]+?)\s*\]/g, "$1");
  return s.replace(/\s+/g, " ").trim();
}

/** Negație inteligentă: flip de semn la comparații simple, altfel `!(...)`. */
export function negateCond(cond: string): string {
  const c = cond.trim();
  const m = c.match(/^(.+?)\s*(=|≠|==|!=|<>|<|>|≤|>=|<=|≥)\s*(.+)$/);
  if (m) {
    const [, a, op, b] = m;
    if (/(&&|\|\||\bși\b|\bsau\b|\bnu\b|\(|\))/i.test(a + b)) return `!(${exprCpp(c)})`;
    const flip: Record<string, string> = {
      ">": "<=",
      "<": ">=",
      ">=": "<",
      "≥": "<",
      "<=": ">",
      "≤": ">",
      "=": "!=",
      "==": "!=",
      "≠": "==",
      "!=": "==",
      "<>": "==",
    };
    const n = flip[op];
    if (n) return `${exprCpp(a)} ${n} ${exprCpp(b)}`;
  }
  if (/^!\(.*\)$/.test(exprCpp(c))) return exprCpp(c).slice(2, -1);
  return `!(${exprCpp(c)})`;
}

export function emitCpp(ast: Stmt[], declared: { name: string; tip: TipVar }[]): string {
  const L: string[] = [];
  L.push("#include <iostream>");
  L.push("using namespace std;");
  L.push("int main()");
  L.push("{");
  const done = new Set<string>();
  const decls: string[] = [];
  const body: string[] = [];
  const ind = (d: number) => "    ".repeat(d + 1);

  const stmt = (st: Stmt, d: number) => {
    switch (st.kind) {
      case "citeste": {
        const fresh = st.vars.filter((v) => !done.has(v));
        for (const v of fresh) {
          decls.push(
            `${ind(0)}${TIP_CPP[declared.find((x) => x.name === v)?.tip ?? st.tip]} ${v};`,
          );
          done.add(v);
        }
        body.push(`${ind(d)}cin >> ${st.vars.join(" >> ")};`);
        break;
      }
      case "atribuire": {
        if (!done.has(st.var)) {
          body.push(`${ind(d)}int ${st.var} = ${exprCpp(st.expr)};`);
          done.add(st.var);
        } else {
          body.push(`${ind(d)}${st.var} = ${exprCpp(st.expr)};`);
        }
        break;
      }
      case "scrie":
        body.push(`${ind(d)}cout << ${st.vars.join(" << ")};`);
        break;
      case "comentariu": {
        const nota = st.text.replace(/^(?:\/\/|#)\s?/, "").trim();
        if (nota) body.push(`${ind(d)}// ${nota}`);
        break;
      }
      case "daca":
        body.push(`${ind(d)}if(${exprCpp(st.cond)})`);
        body.push(`${ind(d)}{`);
        for (const s of st.then) stmt(s, d + 1);
        body.push(`${ind(d)}}`);
        if (st.alt) {
          body.push(`${ind(d)}else`);
          body.push(`${ind(d)}{`);
          for (const s of st.alt) stmt(s, d + 1);
          body.push(`${ind(d)}}`);
        }
        break;
      case "catTimp":
        body.push(`${ind(d)}while(${exprCpp(st.cond)})`);
        body.push(`${ind(d)}{`);
        for (const s of st.body) stmt(s, d + 1);
        body.push(`${ind(d)}}`);
        break;
      case "pentru": {
        const pas = st.pas ? Number(st.pas) : 1;
        let incr: string;
        let test: string;
        if (pas === 1) {
          incr = `${st.v}++`;
          test = `${st.v} <= ${exprCpp(st.stop)}`;
        } else if (pas === -1) {
          incr = `${st.v}--`;
          test = `${st.v} >= ${exprCpp(st.stop)}`;
        } else if (pas > 0) {
          incr = `${st.v} += ${pas}`;
          test = `${st.v} <= ${exprCpp(st.stop)}`;
        } else {
          incr = `${st.v} -= ${Math.abs(pas)}`;
          test = `${st.v} >= ${exprCpp(st.stop)}`;
        }
        done.add(st.v);
        body.push(`${ind(d)}for(int ${st.v} = ${exprCpp(st.start)}; ${test}; ${incr})`);
        body.push(`${ind(d)}{`);
        for (const s of st.body) stmt(s, d + 1);
        body.push(`${ind(d)}}`);
        break;
      }
      case "repeta": {
        body.push(`${ind(d)}do`);
        body.push(`${ind(d)}{`);
        // `pentru`-var din interior nu trebuie redeclarat la nivel global
        for (const s of st.body) stmt(s, d + 1);
        body.push(`${ind(d)}}`);
        const c = st.inchidere === "cat" ? exprCpp(st.cond) : negateCond(st.cond);
        body.push(`${ind(d)}while(${c});`);
        break;
      }
    }
  };
  for (const st of ast) stmt(st, 0);
  L.push(...decls, ...body);
  L.push("    return 0;");
  L.push("}");
  return L.join("\n");
}
