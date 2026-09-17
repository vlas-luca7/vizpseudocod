// Teste de regresie pentru parser + emițător (conform syntax.txt).
// Rulare: pnpm test:regression   (node --experimental-strip-types, fără dependențe)
// Iese cu cod 1 la primul eșec; la final printează rezumatul.
import { parse } from "../src/pseudo/parser.ts";
import { emitCpp, negateCond } from "../src/pseudo/emitter.ts";
import { encodeShare, decodeShare } from "../src/pseudo/share.ts";
import { EXEMPLU } from "../src/pseudo/example.ts";
import { COMPLEX } from "./fixtures.ts";
import { estimateDepths, tabInsertCloser } from "../src/pseudo/indent.ts";
import { deleteRange, moveLines } from "../src/pseudo/blocks.ts";

let pass = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`ok - ${name}`);
  } else {
    failed++;
    console.error(`FAIL - ${name}${detail ? `\n${detail}` : ""}`);
  }
}
function diff(a: string, b: string): string {
  const al = a.split("\n");
  const bl = b.split("\n");
  const out: string[] = [];
  for (let i = 0; i < Math.max(al.length, bl.length); i++) {
    if (al[i] !== bl[i])
      out.push(
        `linia ${i + 1}:\n  actual:   ${JSON.stringify(al[i])}\n  așteptat: ${JSON.stringify(bl[i])}`,
      );
  }
  return out.join("\n");
}
function expectOk(name: string, src: string, canonical: string, cpp: string) {
  const r = parse(src);
  if (!r.ok) {
    check(
      name,
      false,
      `parsare eșuată: ${r.errors.map((e) => `linia ${e.line}: ${e.msg}`).join("; ")}`,
    );
    return;
  }
  check(`${name} [canonic]`, r.canonical === canonical, diff(r.canonical, canonical));
  const got = emitCpp(r.ast, r.declared);
  check(`${name} [c++]`, got === cpp, diff(got, cpp));
}
function expectErr(name: string, src: string, frag: string) {
  const r = parse(src);
  if (r.ok) {
    check(name, false, `așteptam eroare cu "${frag}", dar a parsat ok`);
    return;
  }
  check(
    name,
    r.errors.some((e) => e.msg.includes(frag)),
    `erori: ${r.errors.map((e) => e.msg).join("; ")} (așteptam "${frag}")`,
  );
}

// ── 1. negație inteligentă ──────────────────────────────────────────
check("neg: = → !=", negateCond("k = 4") === "k != 4", negateCond("k = 4"));
check("neg: > → <=", negateCond("x > 9") === "x <= 9", negateCond("x > 9"));
check("neg: ≤ → >", negateCond("x ≤ 0") === "x > 0", negateCond("x ≤ 0"));
check("neg: ≠ → ==", negateCond("a ≠ b") === "a == b", negateCond("a ≠ b"));
check("neg: ≥ → <", negateCond("s ≥ 100") === "s < 100", negateCond("s ≥ 100"));
check(
  "neg: complex → !(...)",
  negateCond("a = 1 sau b = 2") === "!(a == 1 || b == 2)",
  negateCond("a = 1 sau b = 2"),
);

// ── 2. program complex (toate constructele + imbricare) ─────────────
const COMPLEX_CANON = COMPLEX; // deja canonic

const COMPLEX_CPP = `\
#include <iostream>
using namespace std;
int main()
{
    unsigned int n;
    int x;
    cin >> n;
    cin >> x;
    int s = 0;
    int c = 0;
    for(int i = 1; i <= n; i++)
    {
        if(i % 2 == 0)
        {
            s = s + i;
        }
        else
        {
            c = c + 1;
        }
    }
    while(s >= 100)
    {
        s = s/10;
        c = c - 1;
    }
    do
    {
        x = x - 1;
        if(!(x == 0) || c < 3)
        {
            s = s + x;
        }
    }
    while(x > 0);
    do
    {
        n = n - 1;
    }
    while(n > 0);
    cout << s << c;
    return 0;
}`;

expectOk("complex", COMPLEX, COMPLEX_CANON, COMPLEX_CPP);

// ── 3. tipuri + citire multi + default natural + pași pentru ────────
expectOk(
  "tipuri+pentru",
  `citește a
citește b, c (număr real)
d ← 5
pentru j ← 1, 10, 2 execută
  d ← d + j
■
pentru q ← 9, 0, -3 execută
  d ← d - 1
■
scrie d`,
  `citește a (număr natural)
citește b, c (număr real)
d ← 5
pentru j ← 1, 10, 2 execută
  d ← d + j
■
pentru q ← 9, 0, -3 execută
  d ← d - 1
■
scrie d`,
  `\
#include <iostream>
using namespace std;
int main()
{
    unsigned int a;
    double b;
    double c;
    cin >> a;
    cin >> b >> c;
    int d = 5;
    for(int j = 1; j <= 10; j += 2)
    {
        d = d + j;
    }
    for(int q = 9; q >= 0; q -= 3)
    {
        d = d - 1;
    }
    cout << d;
    return 0;
}`,
);

// ── 4. toleranță alias-uri → canonic ─────────────────────────────────
expectOk(
  "aliasuri",
  `CITESTE n (numar intreg)
DACA n == 10 ATUNCI
  n <- n + 1
ALTFEL
  n <- 0
■
cat_timp n <> 0 executa
  n <- n - 1
■`,
  `citește n (număr întreg)
dacă n = 10 atunci
  n ← n + 1
altfel
  n ← 0
■
cât timp n ≠ 0 execută
  n ← n - 1
■`,
  `\
#include <iostream>
using namespace std;
int main()
{
    int n;
    cin >> n;
    if(n == 10)
    {
        n = n + 1;
    }
    else
    {
        n = 0;
    }
    while(n != 0)
    {
        n = n - 1;
    }
    return 0;
}`,
);

// ── 5. exemplul din aplicație rămâne stabil ──────────────────────────
{
  const r = parse(EXEMPLU);
  check("exemplu parsează", r.ok, !r.ok ? r.errors.map((e) => e.msg).join("; ") : "");
  if (r.ok) {
    check("exemplu [canonic stabil]", r.canonical === EXEMPLU, diff(r.canonical, EXEMPLU));
    const cpp = emitCpp(r.ast, r.declared);
    check("exemplu [până când → while negat]", cpp.includes("while(k != 4);"), cpp);
    check("exemplu [fără cast la [ ]]", cpp.includes("x = x/10;") && !cpp.includes("(int)"), cpp);
  }
}

// ── 6. ■ lipsă → auto-adăugat, tot valid ─────────────────────────────
{
  const r = parse(`citește a (număr întreg)\ndacă a = 1 atunci\nscrie a`);
  check("■ auto-adăugat e valid", r.ok);
  if (r.ok) {
    check("■ auto-adăugat [canonic]", r.canonical.endsWith("■"), r.canonical);
    check("■ auto-adăugat [contor]", r.autoClosed === 1, `autoClosed=${r.autoClosed}`);
  }
}
{
  const r = parse(EXEMPLU);
  if (r.ok) check("exemplu [nimic auto-închis]", r.autoClosed === 0, `autoClosed=${r.autoClosed}`);
  const nested = parse(
    `citește a (număr întreg)\ndacă a = 1 atunci\ncât timp a > 0 execută\nscrie a`,
  );
  if (nested.ok)
    check("■ imbricate [contor=2]", nested.autoClosed === 2, `autoClosed=${nested.autoClosed}`);
}

// ── 6b. estimator adâncimi (ghidaje vizuale, tolerant la invalid) ────
check(
  "depths imbricare",
  JSON.stringify(
    estimateDepths(
      `citește a (număr întreg)\ndacă a = 1 atunci\nscrie a\naltfel\nscrie a\n■\nscrie a`,
    ),
  ) === JSON.stringify([0, 0, 1, 0, 1, 0, 0]),
  JSON.stringify(
    estimateDepths(
      `citește a (număr întreg)\ndacă a = 1 atunci\nscrie a\naltfel\nscrie a\n■\nscrie a`,
    ),
  ),
);
check(
  "depths repetă + toleranță invalid",
  JSON.stringify(estimateDepths(`repetă\nscrie a\npână când a = 1\no linie ???`)) ===
    JSON.stringify([0, 1, 0, 0]),
);

// ── 6c. Tab pe linie goală: ■ doar unde se așteaptă un închizător ───
check("tab: nivel 0 → null", tabInsertCloser(`scrie a\n`, 1) === null);
check(
  "tab: înainte de frate dedentat → ■",
  tabInsertCloser(`cât timp a execută\n  scrie a\n\nscrie a`, 2) === "■",
);
check(
  "tab: cu indent existent → ■ dedentat",
  tabInsertCloser(`cât timp a execută\n  scrie a\n  \nscrie a`, 2) === "■",
);
check(
  "tab: înainte de ■ existent → null",
  tabInsertCloser(`dacă a atunci\n  scrie a\n\n■`, 2) === null,
);
check(
  "tab: continuarea corpului (același indent) → null",
  tabInsertCloser(`cât timp a execută\n  scrie a\n\n  scrie a`, 2) === null,
);
check(
  "tab: închide doar blocul interior",
  tabInsertCloser(`dacă a atunci\n  cât timp b execută\n    scrie b\n\n  scrie c`, 3) === "■",
);
check("tab: EOF cu corp → ■", tabInsertCloser(`dacă a atunci\n  scrie a\n`, 2) === "■");
check(
  "tab: EOF imediat după opener → null (se tastează corpul)",
  tabInsertCloser(`dacă a atunci\n`, 1) === null,
);
check(
  "tab: în repetă → null (se închide cu până când)",
  tabInsertCloser(`repetă\n  scrie a\n`, 2) === null,
);
check(
  "tab: înainte de altfel → null",
  tabInsertCloser(`dacă a atunci\n  scrie a\n\naltfel\n  scrie b\n■`, 2) === null,
);
check("tab: pe linie cu text → null", tabInsertCloser(`dacă a atunci\n  scrie a`, 1) === null);
// ── 6d. X șterge blocul întreg echilibrat, nu linia ─────────────────
{
  // ■-ul inserat de Tab păstrează programul valid
  const src = `cât timp a execută\n  scrie a\n\nscrie a`;
  const ins = tabInsertCloser(src, 2);
  const fixed = src.split("\n");
  fixed[2] = ins ?? "";
  const r = parse(`citește a (număr întreg)\n` + fixed.join("\n"));
  check("tab: ■ inserat → program valid", r.ok, !r.ok ? r.errors.map((e) => e.msg).join("; ") : "");
}
const EXL = EXEMPLU.split("\n"); // 0:a 1:k 2:citește 3:repetă 4:cât 5:x← 6:■ 7:dacă 8:a← 9:k← 10:■ 11:până 12:scrie
{
  const r = deleteRange(EXL, 1);
  check(
    "del frunză → o linie",
    r.length === EXL.length - 1 && r[0] === EXL[0] && r[1] === EXL[2],
    r.join("|"),
  );
}
{
  const r = deleteRange(EXL, 4); // opener cât-timp → 4..6
  check(
    "del opener → tot blocul",
    !r.some((l) => l.includes("[x/10]")) && r.some((l) => l.trim() === "dacă x > 9 atunci"),
    r.join("|"),
  );
}
{
  const r = deleteRange(EXL, 6); // ■ → același bloc 4..6
  check(
    "del ■ → tot blocul",
    JSON.stringify(r) === JSON.stringify(deleteRange(EXL, 4)),
    r.join("|"),
  );
}
{
  const r = deleteRange(EXL, 7); // opener dacă → 7..10
  check(
    "del dacă → 7..10",
    !r.includes("dacă x > 9 atunci") && r.includes("până când k = 4"),
    r.join("|"),
  );
}
{
  const r = deleteRange(EXL, 10); // ■ → același bloc 7..10
  check(
    "del ■ (dacă) → 7..10",
    JSON.stringify(r) === JSON.stringify(deleteRange(EXL, 7)),
    r.join("|"),
  );
}
{
  const r = deleteRange(EXL, 3); // repetă → 3..11
  check("del repetă → 3..11", r.join("\n") === `a ← 0\nk ← 0\n${EXL[2]}\nscrie a`, r.join("|"));
}
{
  const r = deleteRange(EXL, 11); // până când → același 3..11
  check(
    "del până când → 3..11",
    JSON.stringify(r) === JSON.stringify(deleteRange(EXL, 3)),
    r.join("|"),
  );
}
{
  const alt =
    `citește a (număr întreg)\ndacă a = 1 atunci\nscrie a\naltfel\nscrie a\n■\nscrie a`.split("\n");
  const r = deleteRange(alt, 3); // altfel → doar ramura else (3..4), ■ rămâne
  check(
    "del altfel → doar else",
    r.join("\n") === `citește a (număr întreg)\ndacă a = 1 atunci\nscrie a\n■\nscrie a`,
    r.join("|"),
  );
  const p = parse(r.join("\n"));
  check("del altfel → program valid", p.ok, !p.ok ? p.errors.map((e) => e.msg).join(";") : "");
}
{
  // toate ștergerile structurale de mai sus lasă programul valid
  for (const i of [4, 6, 7, 10, 3, 11]) {
    const p = parse(deleteRange(EXL, i).join("\n"));
    check(`del idx ${i} → valid`, p.ok, !p.ok ? p.errors.map((e) => e.msg).join(";") : "");
  }
}

// ── 6d-bis. drag mută blocul întreg, nu o linie ─────────────────────
{
  const rep =
    `citește a (număr întreg)\na ← 1\nrepetă\n  a ← a + 1\npână când a = 5\nscrie a`.split("\n");
  const m1 = moveLines(rep, 1, 3, true); // frunză înăuntrul repetă
  check("move frunză în repetă → valid", !!m1 && parse(m1.join("\n")).ok, (m1 ?? []).join("|"));
  check(
    "move frunză în repetă → poziție",
    !!m1 && m1[1] === "repetă" && m1[2] === "a ← 1",
    (m1 ?? []).join("|"),
  );
  const m2 = moveLines(rep, 2, 0, true); // opener repetă → tot blocul la început
  check(
    "move opener repetă → tot blocul",
    !!m2 && m2[0] === "repetă" && m2[2].startsWith("până când"),
    (m2 ?? []).join("|"),
  );
  check("move opener repetă → valid", !!m2 && parse(m2.join("\n")).ok, (m2 ?? []).join("|"));
  const m3 = moveLines(rep, 4, 0, true); // closer repetă → tot blocul la început
  check(
    "move closer repetă → tot blocul",
    !!m3 && m2 !== null && JSON.stringify(m3) === JSON.stringify(m2),
    (m3 ?? []).join("|"),
  );
  check("move în propriul bloc → no-op", moveLines(rep, 2, 3, true) === null);
}

// ── 6e. `;` între instrucțiuni simple ────────────────────────────────
expectOk(
  "punct-virgulă",
  `citește a (număr întreg); a ← a + 1; scrie a`,
  `citește a (număr întreg)\na ← a + 1\nscrie a`,
  `\
#include <iostream>
using namespace std;
int main()
{
    int a;
    cin >> a;
    a = a + 1;
    cout << a;
    return 0;
}`,
);
expectOk(
  "punct-virgulă final tolerat",
  `citește a (număr întreg);\nscrie a;`,
  `citește a (număr întreg)\nscrie a`,
  `\
#include <iostream>
using namespace std;
int main()
{
    int a;
    cin >> a;
    cout << a;
    return 0;
}`,
);
expectErr(
  "bloc cu ; → eroare",
  "citește a (număr întreg)\ndacă a = 1 atunci; scrie a\n■",
  "singure pe linie",
);
expectErr(
  "■ cu ; → eroare",
  "citește a (număr întreg)\ndacă a = 1 atunci\nscrie a\n■; scrie a",
  "singure pe linie",
);
expectErr("repetă cu ; → eroare", "citește a (număr întreg)\na ← 1; repetă", "singure pe linie");

// ── 6f. adnotări tip + comentarii ────────────────────────────────────
expectOk(
  "adnotare tip",
  `citește x (număr natural nenul); scrie x`,
  `citește x (număr natural nenul)\nscrie x`,
  `\
#include <iostream>
using namespace std;
int main()
{
    unsigned int x;
    cin >> x;
    cout << x;
    return 0;
}`,
);
expectOk(
  "adnotare multi-var + fără diacritice",
  `citește a, b (numar real pozitiv)`,
  `citește a, b (număr real pozitiv)`,
  `\
#include <iostream>
using namespace std;
int main()
{
    double a;
    double b;
    cin >> a >> b;
    return 0;
}`,
);
expectErr("tip fără bază → eroare", "citește a (nenul)", "tip invalid");
expectOk(
  "comentarii // și #",
  `// program de test\ncitește a (număr întreg)\n# parcurgem\nscrie a`,
  `// program de test\ncitește a (număr întreg)\n# parcurgem\nscrie a`,
  `\
#include <iostream>
using namespace std;
int main()
{
    int a;
    // program de test
    cin >> a;
    // parcurgem
    cout << a;
    return 0;
}`,
);
expectOk(
  "comentariu în bloc + cu ; și := înăuntru",
  `citește a (număr întreg)\ndacă a = 1 atunci\n  // ramura; a := 1 aici e doar text\n  scrie a\n■`,
  `citește a (număr întreg)\ndacă a = 1 atunci\n  // ramura; a := 1 aici e doar text\n  scrie a\n■`,
  `\
#include <iostream>
using namespace std;
int main()
{
    int a;
    cin >> a;
    if(a == 1)
    {
        // ramura; a := 1 aici e doar text
        cout << a;
    }
    return 0;
}`,
);
expectErr(
  "comentariu trailing → eroare",
  "citește a (număr întreg)\nscrie a // afișează",
  "doar variabile",
);
check(
  "depths ignoră comentariul capcană",
  JSON.stringify(estimateDepths(`dacă a atunci\n// verifică atunci\nscrie a\n■`)) ===
    JSON.stringify([0, 1, 1, 0]),
);

// ── 6g. pluralul tipului → singular canonic ──────────────────────────
expectOk(
  "tipuri plural",
  `citește a (numere naturale)
citește b (numere întregi)
citește c (numere reale)
scrie a`,
  `citește a (număr natural)
citește b (număr întreg)
citește c (număr real)
scrie a`,
  `\
#include <iostream>
using namespace std;
int main()
{
    unsigned int a;
    int b;
    double c;
    cin >> a;
    cin >> b;
    cin >> c;
    cout << a;
    return 0;
}`,
);
expectOk(
  "tip plural + adnotare + underscore",
  `citește a, b (numere_naturale nenule)`,
  `citește a, b (număr natural nenule)`,
  `\
#include <iostream>
using namespace std;
int main()
{
    unsigned int a;
    unsigned int b;
    cin >> a >> b;
    return 0;
}`,
);

// ── 7. erori ─────────────────────────────────────────────────────────
expectErr("reject :=", "a := 5", "`:=`");
expectErr(
  "scrie doar variabile (expresie)",
  "citește a (număr întreg)\nscrie a + 1",
  "doar variabile",
);
expectErr(
  "scrie doar variabile (string)",
  'citește a (număr întreg)\nscrie "salut"',
  "doar variabile",
);
expectErr("dacă fără atunci", "citește a (număr întreg)\ndacă a = 1\nscrie a\n■", "atunci");
expectErr("altfel fără dacă", "citește a (număr întreg)\naltfel\nscrie a\n■", "fără `dacă`");
expectErr(
  "dublu altfel",
  "citește a (număr întreg)\ndacă a = 1 atunci\nscrie a\naltfel\nscrie a\naltfel\nscrie a\n■",
  "un singur `altfel`",
);
expectErr("până când fără repetă", "citește a (număr întreg)\npână când a = 1", "fără `repetă`");
expectErr("repetă fără închidere", "citește a (număr întreg)\nrepetă\nscrie a", "fără închidere");
expectErr(
  "cât timp fără execută",
  "citește a (număr întreg)\ncât timp a > 0\nscrie a\n■",
  "execută",
);
expectErr(
  "pas 0 la pentru",
  "citește n (număr întreg)\npentru i ← 1, n, 0 execută\nscrie i\n■",
  "pasul",
);
expectErr("folosire înainte de declarare", "x ← y + 1", "înainte de");
expectErr("redeclarare alt tip", "citește a (număr întreg)\ncitește a (număr real)", "redeclarată");
expectErr("reject ^", "citește a (număr întreg)\na ← 2 ^ 3", "`^`");
expectErr("reject div", "citește a (număr întreg)\na ← 5 div 2", "`div`");
expectErr(
  "paranteze neechilibrate",
  "citește a (număr întreg)\ndacă (a = 1 atunci\nscrie a\n■",
  "paranteze",
);
expectErr(
  "pentru fără execută",
  "citește n (număr întreg)\npentru i ← 1, n\nscrie i\n■",
  "execută",
);

// ── 8. share roundtrip (diacritice incluse) ──────────────────────────
check("share roundtrip", decodeShare(encodeShare(EXEMPLU)) === EXEMPLU);

console.log(`\n${pass} verificări trecute${failed ? `, ${failed} EȘECURI` : ""}.`);
if (failed) throw new Error(`${failed} verificări eșuate`);
