import { useEffect, useRef, type KeyboardEvent } from "react";
import { tabInsertCloser } from "../pseudo/indent";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  depths: number[];
  /** Câte rânduri-fantomă `└ ■` (blocuri auto-închise la EOF) — pur vizuale. */
  ghosts: number;
  errorLines: Set<number>;
}

function linePad(line: string): string {
  return line.match(/^\s*/)?.[0] ?? "";
}

export default function CodeEditor({ value, onChange, onBlur, depths, ghosts, errorLines }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const guidesRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const syncScroll = () => {
    const ta = taRef.current;
    if (!ta) return;
    if (guidesRef.current)
      guidesRef.current.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
    if (gutterRef.current) gutterRef.current.style.transform = `translateY(${-ta.scrollTop}px)`;
  };
  useEffect(syncScroll);

  const applyEdit = (start: number, end: number, insert: string, cursor: number) => {
    onChange(value.slice(0, start) + insert + value.slice(end));
    requestAnimationFrame(() => {
      taRef.current?.setSelectionRange(cursor, cursor);
      taRef.current?.focus();
    });
  };

  /** Schelete de blocuri — ■ nu trebuie tastat niciodată manual. */
  const insertSkeleton = (kind: string) => {
    const ta = taRef.current;
    const a = ta?.selectionStart ?? value.length;
    const b = ta?.selectionEnd ?? a;
    const ls = value.lastIndexOf("\n", a - 1) + 1;
    const pad = linePad(value.slice(ls, a));
    const body = pad + "  ";
    let text = "";
    let cursor = a;
    switch (kind) {
      case "daca":
        text = `dacă  atunci\n${body}\n${pad}■`;
        cursor = a + 5; // după „dacă ”, la condiție
        break;
      case "cattimp":
        text = `cât timp  execută\n${body}\n${pad}■`;
        cursor = a + 9;
        break;
      case "pentru":
        text = `pentru i ← 1, n execută\n${body}\n${pad}■`;
        cursor = a + 8;
        break;
      case "repeta":
        text = `repetă\n${body}\n${pad}până când `;
        cursor = a + text.length;
        break;
      case "altfel":
        text = `altfel\n${body}`;
        cursor = a + text.length;
        break;
      case "inchide":
        text = `■`;
        cursor = a + 1;
        break;
      default:
        return;
    }
    applyEdit(a, b, text, cursor);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    if (e.key === "Tab") {
      e.preventDefault();
      const a = ta.selectionStart;
      const b = ta.selectionEnd;
      const ls = value.lastIndexOf("\n", a - 1) + 1;
      // Pe linie goală, Tab pune ■-ul dedentat unde se așteaptă un închizător.
      if (a === b && value.slice(ls, a).trim() === "") {
        const lineIdx = value.slice(0, a).split("\n").length - 1;
        const closer = tabInsertCloser(value, lineIdx);
        if (closer !== null) {
          applyEdit(ls, a, closer, ls + closer.length);
          return;
        }
      }
      applyEdit(a, b, "  ", a + 2);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const a = ta.selectionStart;
      const ls = value.lastIndexOf("\n", a - 1) + 1;
      const prev = value.slice(ls, a);
      const pad = linePad(prev);
      const t = prev.trim();
      const body = pad + "  ";
      let insert = `\n${pad}`;
      let cursor = a + pad.length + 1;
      if (
        /^dacă\s+.+\s+atunci$/i.test(t) ||
        /^cât timp\s+.+\s+execută$/i.test(t) ||
        /^pentru\s+.+\s+execută$/i.test(t)
      ) {
        // Deschidere bloc → corp + ■ auto-inserat; cursorul rămâne pe linia goală.
        insert = `\n${body}\n${pad}■`;
        cursor = a + 1 + body.length;
      } else if (/^repetă$/i.test(t)) {
        insert = `\n${body}\n${pad}până când `;
        cursor = a + insert.length;
      } else if (/^altfel$/i.test(t)) {
        insert = `\n${body}`;
        cursor = a + insert.length;
      }
      applyEdit(a, a, insert, cursor);
    }
  };

  const lines = value.split("\n");
  const lastDepth = depths.length ? depths[depths.length - 1] : 0;
  const ghostDepths = Array.from({ length: ghosts }).map((_, i) => Math.max(0, lastDepth - 1 - i));

  return (
    <div className="codecol">
      <div className="insertbar">
        <span className="hint">Inserează:</span>
        <button onClick={() => insertSkeleton("daca")}>dacă</button>
        <button onClick={() => insertSkeleton("cattimp")}>cât timp</button>
        <button onClick={() => insertSkeleton("pentru")}>pentru</button>
        <button onClick={() => insertSkeleton("repeta")}>repetă</button>
        <button onClick={() => insertSkeleton("altfel")}>altfel</button>
        <button
          onClick={() => insertSkeleton("inchide")}
          title="Închizător de bloc — de obicei îl pune automat Enter sau Tab pe linie goală"
        >
          ■
        </button>
        <span className="hint">Tab pe linie goală = ■ unde se așteaptă un închizător</span>
      </div>
      <div className="codewrap">
        <div className="gutter">
          <div ref={gutterRef}>
            {lines.map((_, i) => (
              <div key={i} className={errorLines.has(i + 1) ? "gln err" : "gln"}>
                {i + 1}
              </div>
            ))}
          </div>
        </div>
        <div className="editarea">
          <div className="guidelayer" aria-hidden="true">
            <div ref={guidesRef} className="guides">
              {lines.map((_, i) => (
                <div className="grow" key={i}>
                  {Array.from({ length: depths[i] ?? 0 }).map((_, k) => (
                    <span key={k} className="grail" />
                  ))}
                </div>
              ))}
              {ghostDepths.map((d, i) => (
                <div className="grow ghost" key={`g${i}`}>
                  {Array.from({ length: d }).map((_, k) => (
                    <span key={k} className="grail" />
                  ))}
                  <span className="ghostext">└ ■</span>
                </div>
              ))}
            </div>
          </div>
          <textarea
            ref={taRef}
            className="code"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={onBlur}
            onScroll={syncScroll}
            spellCheck={false}
            wrap="off"
          />
        </div>
      </div>
    </div>
  );
}
