// Fixturi partajate între regression.ts și testul e2e.
export const COMPLEX = `citește n (număr natural)
citește x (număr întreg)
s ← 0
c ← 0
pentru i ← 1, n execută
  dacă i % 2 = 0 atunci
    s ← s + i
  altfel
    c ← c + 1
  ■
■
cât timp s ≥ 100 execută
  s ← [s/10]
  c ← c - 1
■
repetă
  x ← x - 1
  dacă nu (x = 0) sau c < 3 atunci
    s ← s + x
  ■
până când x ≤ 0
repetă
  n ← n - 1
cât timp n > 0
scrie s, c`;

// stdin pentru e2e (n=3, x=20) + stdout așteptat, calculat manual:
// pentru: i=1→c=1, i=2→s=2, i=3→c=2; s=2<100 sare peste cât-timp;
// repetă1: x=19..0, s=2+190=192; repetă2: n→0; scrie s,c lipit → "1922".
export const COMPLEX_STDIN = "3 20\n";
export const COMPLEX_EXPECT = "1922";
