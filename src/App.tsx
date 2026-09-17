import { useEffect, useMemo, useRef, useState } from "react";
import { parse, type Stmt } from "./pseudo/parser";
import { emitCpp } from "./pseudo/emitter";
import { encodeShare, decodeShare } from "./pseudo/share";
import { EXEMPLU } from "./pseudo/example";
import { estimateDepths } from "./pseudo/indent";
import { deleteRange, dragRange, moveLines } from "./pseudo/blocks";
import CodeEditor from "./editor/CodeEditor";
import CppView from "./editor/CppView";
import "./App.css";

type Mode = "blocuri" | "cod";

interface Row {
  text: string;
  depth: number;
  kind: "open" | "mid" | "close" | "leaf" | "comment";
}

function flatten(ast: Stmt[], depth = 0): Row[] {
  const rows: Row[] = [];
  for (const st of ast) {
    switch (st.kind) {
      case "atribuire":
        rows.push({ text: `${st.var} ← ${st.expr}`, depth, kind: "leaf" });
        break;
      case "citeste": {
        const tip =
          st.tip === "natural"
            ? "număr natural"
            : st.tip === "intreg"
              ? "număr întreg"
              : "număr real";
        rows.push({
          text: `citește ${st.vars.join(", ")} (${tip}${st.adnotare ? ` ${st.adnotare}` : ""})`,
          depth,
          kind: "leaf",
        });
        break;
      }
      case "comentariu":
        rows.push({ text: st.text, depth, kind: "comment" });
        break;
      case "scrie":
        rows.push({ text: `scrie ${st.vars.join(", ")}`, depth, kind: "leaf" });
        break;
      case "daca":
        rows.push({ text: `┌ dacă ${st.cond} atunci`, depth, kind: "open" });
        rows.push(...flatten(st.then, depth + 1));
        if (st.alt) {
          rows.push({ text: "altfel", depth, kind: "mid" });
          rows.push(...flatten(st.alt, depth + 1));
        }
        rows.push({ text: "└ ■", depth, kind: "close" });
        break;
      case "catTimp":
        rows.push({ text: `┌ cât timp ${st.cond} execută`, depth, kind: "open" });
        rows.push(...flatten(st.body, depth + 1));
        rows.push({ text: "└ ■", depth, kind: "close" });
        break;
      case "pentru":
        rows.push({
          text: `┌ pentru ${st.v} ← ${st.start}, ${st.stop}${st.pas ? `, ${st.pas}` : ""} execută`,
          depth,
          kind: "open",
        });
        rows.push(...flatten(st.body, depth + 1));
        rows.push({ text: "└ ■", depth, kind: "close" });
        break;
      case "repeta":
        rows.push({ text: "┌ repetă", depth, kind: "open" });
        rows.push(...flatten(st.body, depth + 1));
        rows.push({
          text: `└ ${st.inchidere === "pana" ? "până când" : "cât timp"} ${st.cond}`,
          depth,
          kind: "close",
        });
        break;
    }
  }
  return rows;
}

interface PaletteItem {
  label: string;
  hint: string;
  template: string;
}

const PALETTE: PaletteItem[] = [
  { label: "citește", hint: "citire cu tip", template: "citește x (număr natural)" },
  { label: "scrie", hint: "afișare variabile", template: "scrie a" },
  { label: "atribuire", hint: "a ← expresie", template: "a ← 0" },
  { label: "dacă", hint: "ramificare", template: "dacă x > 0 atunci\n  scrie x\n■" },
  {
    label: "cât timp",
    hint: "buclă cu test inițial",
    template: "cât timp x > 0 execută\n  x ← x - 1\n■",
  },
  { label: "pentru", hint: "buclă cu contor", template: "pentru i ← 1, n execută\n  scrie i\n■" },
  {
    label: "repetă",
    hint: "buclă cu test final",
    template: "repetă\n  x ← x - 1\npână când x = 0",
  },
  { label: "altfel", hint: "ramura else (într-un dacă)", template: "altfel" },
  { label: "comentariu", hint: "notă indicativă (// …)", template: "// notă" },
];

function loadInitial(): { source: string; draft: string } {
  const h = window.location.hash.match(/#c=([A-Za-z0-9\-_]+)/);
  if (h) {
    try {
      const s = decodeShare(h[1]);
      return { source: s, draft: s };
    } catch {
      /* ignoră */
    }
  }
  const source = localStorage.getItem("vizpseudocod") ?? EXEMPLU;
  const draft = localStorage.getItem("vizpseudocod-draft") ?? source;
  return { source, draft };
}

function emitOf(src: string): string {
  const r = parse(src);
  return r.ok ? emitCpp(r.ast, r.declared) : "";
}

export default function App() {
  const [initial] = useState(loadInitial);
  const [source, setSource] = useState(initial.source);
  const [mode, setMode] = useState<Mode>("cod");
  const [draft, setDraft] = useState(initial.draft);
  const [cpp, setCpp] = useState(() => emitOf(initial.source));
  const [cppStale, setCppStale] = useState(false);
  const [blockMsg, setBlockMsg] = useState("");
  const [dragRow, setDragRow] = useState<number | null>(null);
  const [dropPos, setDropPos] = useState<{ idx: number; before: boolean } | null>(null);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editVal, setEditVal] = useState("");
  const debounceRef = useRef<number | undefined>(undefined);
  const blockMsgRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (blockMsg) blockMsgRef.current?.scrollIntoView({ block: "nearest" });
  }, [blockMsg]);

  const parsed = useMemo(() => parse(source), [source]);
  const rows: Row[] = useMemo(() => (parsed.ok ? flatten(parsed.ast) : []), [parsed]);
  const draftParsed = useMemo(() => parse(draft), [draft]);
  const depths = useMemo(() => estimateDepths(draft), [draft]);
  const draftErrors = useMemo(() => (!draftParsed.ok ? draftParsed.errors : []), [draftParsed]);
  const errorLines = useMemo(() => new Set(draftErrors.map((e) => e.line)), [draftErrors]);
  const ghosts = draftParsed.ok ? draftParsed.autoClosed : 0;

  useEffect(() => {
    localStorage.setItem("vizpseudocod", source);
  }, [source]);
  useEffect(() => {
    localStorage.setItem("vizpseudocod-draft", draft);
  }, [draft]);

  // Blocuri: regenerare imediată la orice schimbare validă.
  useEffect(() => {
    if (mode !== "blocuri") return;
    if (parsed.ok) {
      setCpp(emitCpp(parsed.ast, parsed.declared));
      setCppStale(false);
    } else {
      setCppStale(true);
    }
  }, [mode, parsed]);

  // Cod: regenerare cu debounce — doar „când utilizatorul nu mai scrie”.
  useEffect(() => {
    if (mode !== "cod") return;
    setCppStale(true);
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      const r = parse(draft);
      if (r.ok) {
        setCpp(emitCpp(r.ast, r.declared));
        setCppStale(false);
      }
    }, 700);
    return () => window.clearTimeout(debounceRef.current);
  }, [mode, draft]);

  const flushCpp = () => {
    window.clearTimeout(debounceRef.current);
    const r = parse(draft);
    if (r.ok) {
      setCpp(emitCpp(r.ast, r.declared));
      setCppStale(false);
    }
  };

  const switchMode = (m: Mode) => {
    if (m === "blocuri") {
      const r = parse(draft);
      if (!r.ok) return;
      setSource(r.canonical);
      setDraft(r.canonical);
      setMode("blocuri");
    } else {
      setDraft(source);
      setMode("cod");
    }
  };

  // ── operații pe linii (modul blocuri) ──
  const canonLines = () => (parsed.ok ? parsed.canonical.split("\n") : []);
  const commitLines = (ls: string[]) => {
    const r = parse(ls.join("\n"));
    if (!r.ok) {
      setBlockMsg(r.errors.map((e) => `linia ${e.line}: ${e.msg}`).join("\n"));
      return false;
    }
    setBlockMsg("");
    setSource(r.canonical);
    return true;
  };
  const appendTemplate = (tpl: string) => {
    commitLines([...canonLines(), ...tpl.split("\n")]);
  };
  const delLine = (i: number) => {
    // X șterge blocul întreg echilibrat (sau ramura else / linia frunză),
    // ca layout-ul să rămână mereu valid — niciodată o singură linie structurală.
    const ls = canonLines();
    const rest = deleteRange(ls, i);
    if (rest.length === ls.length) return;
    setEditingIdx(null);
    commitLines(rest);
  };
  const moveRow = (from: number, to: number, before: boolean) => {
    const ls = canonLines();
    const moved = moveLines(ls, from, to, before);
    if (!moved) return; // drop în interiorul propriului bloc: no-op
    commitLines(moved);
  };
  const insertTemplateAt = (idx: number, before: boolean, tpl: string) => {
    const ls = canonLines();
    ls.splice(before ? idx : idx + 1, 0, ...tpl.split("\n"));
    commitLines(ls);
  };
  const commitEdit = () => {
    if (editingIdx === null) return;
    const ls = canonLines();
    if (!editVal.trim()) ls.splice(editingIdx, 1);
    else ls[editingIdx] = editVal;
    if (commitLines(ls)) setEditingIdx(null);
  };

  const onRowDragOver = (i: number, e: React.DragEvent) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    setDropPos({ idx: i, before: e.clientY - rect.top < rect.height / 2 });
  };
  const onRowDrop = (i: number, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation(); // altfel ajunge și la canvas → mutare la sfârșit
    const tpl = e.dataTransfer.getData("text/x-tpl");
    const row = e.dataTransfer.getData("text/x-row");
    const pos = dropPos ?? { idx: i, before: false };
    if (tpl) insertTemplateAt(pos.idx, pos.before, tpl);
    else if (row !== "" && dragRow !== null && dragRow !== pos.idx)
      moveRow(dragRow, pos.idx, pos.before);
    setDropPos(null);
    setDragRow(null);
  };

  const copyCpp = async () => {
    await navigator.clipboard.writeText(cpp);
  };
  const share = async () => {
    const code =
      mode === "cod"
        ? draftParsed.ok
          ? draftParsed.canonical
          : draft
        : parsed.ok
          ? parsed.canonical
          : source;
    const url = `${location.origin}${location.pathname}#c=${encodeShare(code)}`;
    window.location.hash = `#c=${encodeShare(code)}`;
    await navigator.clipboard.writeText(url);
    setBlockMsg("Link de share copiat în clipboard.");
  };
  const loadExample = () => {
    if (
      (source !== EXEMPLU || draft !== EXEMPLU) &&
      !window.confirm("Butonul Exemplu înlocuiește conținutul actual (pseudocod + C++). Continui?")
    )
      return;
    setSource(EXEMPLU);
    setDraft(EXEMPLU);
    setBlockMsg("");
  };

  const strip = (t: string) => t.replace(/^┌ /, "").replace(/^└ /, "");

  return (
    <div className="ide">
      <header className="bar">
        <strong>vizpseudocod</strong>
        <span className="badge">BAC · v1</span>
        <div className="spacer" />
        <div className="toggle" role="tablist">
          <button
            className={mode === "blocuri" ? "on" : ""}
            onClick={() => mode !== "blocuri" && draftParsed.ok && switchMode("blocuri")}
            title={
              !draftParsed.ok && mode === "cod" ? "Sintaxa trebuie să fie validă" : "Mod blocuri"
            }
          >
            Blocuri
          </button>
          <button className={mode === "cod" ? "on" : ""} onClick={() => switchMode("cod")}>
            Cod
          </button>
        </div>
        <button onClick={copyCpp} disabled={!cpp}>
          Copiază C++
        </button>
        <button onClick={share}>Share</button>
        <button
          onClick={loadExample}
          title="Încarcă exemplul — atenție, șterge conținutul existent"
        >
          Exemplu
        </button>
      </header>

      <main className="split">
        <section className="pane left">
          <div className="pane-title">
            pseudocod{" "}
            {mode === "cod" && !draftParsed.ok && (
              <span className="err-tag">invalid — comutarea spre blocuri e blocată</span>
            )}
          </div>
          {mode === "cod" ? (
            <>
              <CodeEditor
                value={draft}
                onChange={setDraft}
                onBlur={flushCpp}
                depths={depths}
                ghosts={ghosts}
                errorLines={errorLines}
              />
              {draftErrors.length > 0 && (
                <ul className="errors">
                  {draftErrors.map((e, i) => (
                    <li key={i}>
                      linia {e.line}: {e.msg}
                    </li>
                  ))}
                </ul>
              )}
              <div className="row">
                <button
                  disabled={!draftParsed.ok}
                  title={
                    !draftParsed.ok
                      ? "Sintaxa trebuie să fie validă pentru a trece în blocuri"
                      : "Aplică și treci în blocuri"
                  }
                  onClick={() => switchMode("blocuri")}
                >
                  Aplică → Blocuri
                </button>
                {!draftParsed.ok && (
                  <span className="hint">rezolvă erorile ca să deblochezi comutatorul</span>
                )}
              </div>
            </>
          ) : (
            <div className="blockpane">
              <aside className="palette">
                <div className="pal-title">Blocuri</div>
                {PALETTE.map((p) => (
                  <div
                    key={p.label}
                    className="pcard"
                    draggable
                    title={p.hint}
                    onDragStart={(e) => e.dataTransfer.setData("text/x-tpl", p.template)}
                    onClick={() => appendTemplate(p.template)}
                  >
                    {p.label}
                  </div>
                ))}
                <div className="hint">trage în listă sau click = adaugă la sfârșit</div>
              </aside>
              <div
                className="canvas"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const tpl = e.dataTransfer.getData("text/x-tpl");
                  const row = e.dataTransfer.getData("text/x-row");
                  if (tpl) appendTemplate(tpl);
                  else if (row !== "" && dragRow !== null) {
                    const ls = canonLines();
                    const [mFrom, mTo] = dragRange(ls, dragRow);
                    if (mTo === ls.length - 1) return; // deja la sfârșit
                    const rest = ls.filter((_, i) => i < mFrom || i > mTo);
                    rest.push(...ls.slice(mFrom, mTo + 1));
                    commitLines(rest);
                  }
                  setDropPos(null);
                  setDragRow(null);
                }}
              >
                <ol className="blocks">
                  {rows.map((r, i) => (
                    <li
                      key={i}
                      className={`brow ${r.kind}`}
                      onDragOver={(e) => onRowDragOver(i, e)}
                      onDrop={(e) => onRowDrop(i, e)}
                    >
                      {dropPos?.idx === i && dropPos.before && <div className="dropline" />}
                      <span
                        className="grip"
                        draggable
                        title="trage ca să muți"
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/x-row", String(i));
                          setDragRow(i);
                        }}
                        onDragEnd={() => {
                          setDragRow(null);
                          setDropPos(null);
                        }}
                      >
                        ⠿
                      </span>
                      <span className="rail">
                        {Array.from({ length: r.depth }).map((_, k) => (
                          <span key={k} className="vline" />
                        ))}
                      </span>
                      {editingIdx === i ? (
                        <input
                          className="bedit"
                          autoFocus
                          value={editVal}
                          onChange={(e) => setEditVal(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitEdit();
                            if (e.key === "Escape") setEditingIdx(null);
                          }}
                        />
                      ) : (
                        <span
                          className="btext"
                          title="click ca să editezi"
                          onClick={() => {
                            setEditingIdx(i);
                            setEditVal(strip(r.text));
                          }}
                        >
                          {strip(r.text)}
                        </span>
                      )}
                      <button className="x" title="șterge blocul" onClick={() => delLine(i)}>
                        ×
                      </button>
                      {dropPos?.idx === i && !dropPos.before && <div className="dropline" />}
                    </li>
                  ))}
                </ol>
                {blockMsg && (
                  <pre ref={blockMsgRef} role="alert" className="errors">
                    {blockMsg}
                  </pre>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="pane right">
          <div className="pane-title">
            C++{" "}
            {cppStale && cpp && (
              <span className="warn-tag">se regenerează automat când nu mai scrii…</span>
            )}
          </div>
          <CppView code={cpp} />
        </section>
      </main>
    </div>
  );
}
