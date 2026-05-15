"use client";

/**
 * /cards — Trading card evaluator
 *
 * Mobile-friendly UI. The user snaps front + back of any trading card
 * (Pokemon, hockey, baseball, MTG, etc.). The page calls
 * ${NEXT_PUBLIC_BACKEND_URL}/cards/grade twice:
 *   1. mode=identify (fires automatically once both photos are present) —
 *      prefills the metadata fields from what the model can read off the card.
 *   2. mode=evaluate (when the user taps "Evaluate card") — returns condition
 *      scales, an overall 0–10 grade, authenticity confidence, and a USD
 *      valuation.
 *
 * History is kept in localStorage on the user's device.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ---------- Types ----------
type CardType =
  | ""
  | "Pokemon"
  | "Baseball"
  | "Hockey"
  | "Basketball"
  | "Football"
  | "Soccer"
  | "Magic: The Gathering"
  | "Yu-Gi-Oh!"
  | "Other / Unknown";

type GradedKind = "" | "PSA" | "BGS / Beckett" | "CGC" | "SGC" | "Other slab";

interface Meta {
  type: CardType;
  year: string;
  name: string;          // player / character
  set: string;
  number: string;
  graded: GradedKind;
  notes: string;
}

interface Identification {
  type?: string;
  player_or_character?: string;
  year?: string;
  set?: string;
  card_number?: string;
  rarity?: string;
  notes?: string;
}

interface RunSpread {
  count: number;
  overall_grade: number[];
  scales: { centering: number[]; corners: number[]; edges: number[]; surface: number[] };
  valuation_usd: { low: number[]; mid: number[]; high: number[] };
}

interface Evaluation {
  identification: Identification;
  scales: {
    centering: number | null;
    corners: number | null;
    edges: number | null;
    surface: number | null;
  };
  overall_grade: number | null;
  grade_label: string;
  authenticity_confidence: string;
  valuation_usd: { low: number | null; mid: number | null; high: number | null };
  highlights: string[];
  concerns: string[];
  recommendations: string[];
  // Present when the backend ran multiple parallel evaluations.
  runs?: RunSpread;
}

interface HistoryItem {
  savedAt: number;
  meta: Meta;
  result: Evaluation;
  thumb: string;
}

interface ProcessedImage {
  sendUrl: string;   // ~1024px JPEG, sent to model
  thumbUrl: string;  // ~400px JPEG, kept in localStorage
}

// ---------- Constants ----------
const SEND_MAX_DIM = 1024;
const THUMB_MAX_DIM = 400;
const STORAGE_KEY = "card_evaluator_history_v1";
const MAX_HISTORY = 20;
const MAX_PHOTOS_PER_SIDE = 6;
const CARD_TYPES: CardType[] = [
  "",
  "Pokemon",
  "Baseball",
  "Hockey",
  "Basketball",
  "Football",
  "Soccer",
  "Magic: The Gathering",
  "Yu-Gi-Oh!",
  "Other / Unknown",
];
const GRADED_KINDS: GradedKind[] = ["", "PSA", "BGS / Beckett", "CGC", "SGC", "Other slab"];

const EMPTY_META: Meta = {
  type: "",
  year: "",
  name: "",
  set: "",
  number: "",
  graded: "",
  notes: "",
};

// ---------- Image helpers ----------
function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

function resizeToDataUrl(img: HTMLImageElement, maxDim: number, quality: number): string {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const cw = Math.round(w * scale);
  const ch = Math.round(h * scale);
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create canvas context.");
  ctx.drawImage(img, 0, 0, cw, ch);
  return canvas.toDataURL("image/jpeg", quality);
}

async function processFile(file: File): Promise<ProcessedImage> {
  const img = await fileToImage(file);
  return {
    sendUrl: resizeToDataUrl(img, SEND_MAX_DIM, 0.85),
    thumbUrl: resizeToDataUrl(img, THUMB_MAX_DIM, 0.7),
  };
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1000) return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtGrade(n: number | null | undefined): string {
  if (n == null) return "—";
  return (Math.round(n * 10) / 10).toString();
}

function num(x: unknown): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function numArray(x: unknown): number[] {
  if (!Array.isArray(x)) return [];
  const out: number[] = [];
  for (const v of x) {
    const n = Number(v);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function normalizeEvaluation(raw: any): Evaluation {
  const id = (raw && raw.identification) || {};
  const s = (raw && raw.scales) || {};
  const v = (raw && (raw.valuation_usd || raw.valuation)) || {};
  const r = raw && raw.runs;
  const runs: RunSpread | undefined = r
    ? {
        count: Number.isFinite(Number(r.count)) ? Number(r.count) : 0,
        overall_grade: numArray(r.overall_grade),
        scales: {
          centering: numArray(r.scales?.centering),
          corners: numArray(r.scales?.corners),
          edges: numArray(r.scales?.edges),
          surface: numArray(r.scales?.surface),
        },
        valuation_usd: {
          low: numArray(r.valuation_usd?.low),
          mid: numArray(r.valuation_usd?.mid),
          high: numArray(r.valuation_usd?.high),
        },
      }
    : undefined;
  return {
    identification: {
      type: id.type || "",
      player_or_character: id.player_or_character || id.player || id.character || "",
      year: id.year || "",
      set: id.set || "",
      card_number: id.card_number || id.number || "",
      rarity: id.rarity || "",
      notes: id.notes || "",
    },
    scales: {
      centering: num(s.centering),
      corners: num(s.corners),
      edges: num(s.edges),
      surface: num(s.surface),
    },
    overall_grade: num(raw?.overall_grade),
    grade_label: raw?.grade_label || "",
    authenticity_confidence: raw?.authenticity_confidence || "",
    valuation_usd: {
      low: num(v.low),
      mid: num(v.mid),
      high: num(v.high),
    },
    highlights: Array.isArray(raw?.highlights) ? raw.highlights : [],
    concerns: Array.isArray(raw?.concerns) ? raw.concerns : [],
    recommendations: Array.isArray(raw?.recommendations) ? raw.recommendations : [],
    runs,
  };
}

// Spread helpers — produce a "8.5 (8.0–9.0)" style suffix when we have ≥2 samples.
function spreadRange(values: number[] | undefined): { lo: number; hi: number } | null {
  if (!values || values.length < 2) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) return null;
  return { lo, hi };
}

function matchCardType(s: string): CardType {
  const v = (s || "").trim();
  if (!v) return "";
  for (const t of CARD_TYPES) {
    if (t && t.toLowerCase() === v.toLowerCase()) return t;
  }
  return "Other / Unknown";
}

function matchGraded(s: string): GradedKind {
  const v = (s || "").trim();
  if (!v || v.toLowerCase() === "raw") return "";
  for (const k of GRADED_KINDS) {
    if (k && k.toLowerCase() === v.toLowerCase()) return k;
  }
  return "Other slab";
}

// ---------- API calls ----------
// Backend lives on Render (api.curriculate.net), same env that holds
// OPENAI_API_KEY. Override at build time via NEXT_PUBLIC_BACKEND_URL.
const BACKEND_URL =
  (typeof process !== "undefined" && process.env && process.env.NEXT_PUBLIC_BACKEND_URL) ||
  "https://api.curriculate.net";

async function callGradeApi(payload: object): Promise<any> {
  const res = await fetch(`${BACKEND_URL}/cards/grade`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {}
    throw new Error(msg);
  }
  const data = await res.json();
  return data?.result;
}

// ---------- Component ----------
export default function CardsPage() {
  const [fronts, setFronts] = useState<ProcessedImage[]>([]);
  const [backs, setBacks] = useState<ProcessedImage[]>([]);
  const [meta, setMeta] = useState<Meta>(EMPTY_META);
  const [autofilled, setAutofilled] = useState<Partial<Record<keyof Meta, boolean>>>({});
  const [identStatus, setIdentStatus] = useState<{ text: string; tone: "info" | "done" | "err" | "loading" } | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Evaluation | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [formExpanded, setFormExpanded] = useState(false);
  const identifyTokenRef = useRef(0);

  // Load history once.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setHistory(JSON.parse(raw));
    } catch {}
  }, []);

  // Persist history when it changes.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
    } catch {}
  }, [history]);

  const bothPhotos = fronts.length > 0 && backs.length > 0;

  // Auto-identify when both sides have at least one photo.
  // Re-runs if the user adds/removes photos.
  useEffect(() => {
    if (!bothPhotos) return;
    let cancelled = false;
    const token = ++identifyTokenRef.current;
    setIdentStatus({ text: "Identifying card…", tone: "loading" });
    (async () => {
      try {
        const raw = await callGradeApi({
          mode: "identify",
          frontDataUrls: fronts.map((p) => p.sendUrl),
          backDataUrls: backs.map((p) => p.sendUrl),
        });
        if (cancelled || token !== identifyTokenRef.current) return;
        const fills: Partial<Record<keyof Meta, boolean>> = {};
        setMeta((prev) => {
          const next: Meta = { ...prev };
          const setIfEmpty = (key: keyof Meta, value: string) => {
            if (!prev[key] && value) {
              (next as any)[key] = value;
              fills[key] = true;
            }
          };
          setIfEmpty("type", matchCardType(raw?.type || ""));
          setIfEmpty("year", raw?.year || "");
          setIfEmpty("name", raw?.name || raw?.player_or_character || "");
          setIfEmpty("set", raw?.set || "");
          setIfEmpty("number", raw?.number || raw?.card_number || "");
          setIfEmpty("graded", matchGraded(raw?.graded || ""));
          return next;
        });
        setAutofilled((prev) => ({ ...prev, ...fills }));
        setIdentStatus({ text: "Identified · tap edit if anything is wrong", tone: "done" });
        setFormExpanded(false); // collapse on successful identify
      } catch (err) {
        if (cancelled || token !== identifyTokenRef.current) return;
        const message = err instanceof Error ? err.message : "Could not identify card.";
        setIdentStatus({ text: message, tone: "err" });
        setFormExpanded(true); // show the form so they can enter details manually
      }
    })();
    return () => {
      cancelled = true;
    };
    // Only re-run when the set of send URLs actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fronts.map((p) => p.sendUrl).join("|"), backs.map((p) => p.sendUrl).join("|")]);

  const onAddPhoto = useCallback(
    (side: "front" | "back") => async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      if (!files.length) return;
      try {
        const processed = await Promise.all(files.map((f) => processFile(f)));
        if (side === "front") {
          setFronts((prev) => [...prev, ...processed].slice(0, MAX_PHOTOS_PER_SIDE));
        } else {
          setBacks((prev) => [...prev, ...processed].slice(0, MAX_PHOTOS_PER_SIDE));
        }
        setError(null);
      } catch {
        setError("Could not read one of those images. Try a different photo.");
      } finally {
        e.target.value = "";
      }
    },
    []
  );

  const onRemovePhoto = useCallback((side: "front" | "back", idx: number) => {
    if (side === "front") setFronts((prev) => prev.filter((_, i) => i !== idx));
    else setBacks((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const updateMeta = useCallback(<K extends keyof Meta>(key: K, value: Meta[K]) => {
    setMeta((prev) => ({ ...prev, [key]: value }));
    setAutofilled((prev) => ({ ...prev, [key]: false }));
  }, []);

  const reset = useCallback(() => {
    setFronts([]);
    setBacks([]);
    setMeta(EMPTY_META);
    setAutofilled({});
    setIdentStatus(null);
    setResult(null);
    setError(null);
    setFormExpanded(false);
  }, []);

  const onEvaluate = useCallback(async () => {
    if (!bothPhotos) return;
    setEvaluating(true);
    setError(null);
    setResult(null);
    try {
      const raw = await callGradeApi({
        mode: "evaluate",
        frontDataUrls: fronts.map((p) => p.sendUrl),
        backDataUrls: backs.map((p) => p.sendUrl),
        meta,
      });
      const evalResult = normalizeEvaluation(raw);
      setResult(evalResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not evaluate this card.");
    } finally {
      setEvaluating(false);
    }
  }, [fronts, backs, meta, bothPhotos]);

  const onSaveHistory = useCallback(() => {
    if (!result || fronts.length === 0) return;
    const item: HistoryItem = {
      savedAt: Date.now(),
      meta,
      result,
      thumb: fronts[0].thumbUrl,
    };
    setHistory((h) => [item, ...h].slice(0, MAX_HISTORY));
  }, [result, fronts, meta]);

  const clearHistory = useCallback(() => {
    if (typeof window !== "undefined" && window.confirm("Clear all saved evaluations?")) {
      setHistory([]);
    }
  }, []);

  const openHistory = useCallback((item: HistoryItem) => {
    setResult(item.result);
    setMeta(item.meta);
    setAutofilled({});
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  const resultTitle = useMemo(() => {
    if (!result) return "";
    const id = result.identification;
    const parts = [id.year, id.player_or_character, id.set].filter(Boolean);
    return parts.length ? parts.join(" · ") : meta.name || meta.type || "Card";
  }, [result, meta]);

  const resultSubtitle = useMemo(() => {
    if (!result) return "";
    const id = result.identification;
    const parts = [id.type, id.card_number ? `#${id.card_number}` : "", id.rarity].filter(Boolean);
    return parts.join(" · ") || "—";
  }, [result]);

  return (
    <>
      <style>{styles}</style>
      <main className="ce-root">
        <h1 className="ce-h1">Card Evaluator</h1>
        <p className="ce-sub">Snap front &amp; back of any trading card — Pokemon, hockey, baseball, MTG, and more.</p>

        {/* Step 1: photos */}
        <section className="ce-card">
          <div className="ce-section-title">1. Photograph the card</div>
          <p className="ce-strip-hint">
            One front + one back is enough — add extra angles or close-ups if there's glare or you
            want a sharper read on condition. Up to {MAX_PHOTOS_PER_SIDE} per side.
          </p>
          <PhotoStrip
            label="Front"
            images={fronts}
            onAdd={onAddPhoto("front")}
            onRemove={(idx) => onRemovePhoto("front", idx)}
            max={MAX_PHOTOS_PER_SIDE}
          />
          <PhotoStrip
            label="Back"
            images={backs}
            onAdd={onAddPhoto("back")}
            onRemove={(idx) => onRemovePhoto("back", idx)}
            max={MAX_PHOTOS_PER_SIDE}
          />
        </section>

        {/* Step 2: details — summary by default, form expands on edit or identify failure */}
        <section className="ce-card">
          <div className="ce-section-row">
            <div className="ce-section-title" style={{ marginBottom: 0 }}>
              2. What we see
            </div>
            {identStatus && (
              <span className={`ce-ident-status ${identStatus.tone}`}>
                {identStatus.tone === "loading" && <span className="ce-mini-spin" />}
                <span>{identStatus.text}</span>
              </span>
            )}
          </div>

          {!bothPhotos ? (
            <div className="ce-hint">Snap both photos above and we'll identify the card.</div>
          ) : identStatus?.tone === "loading" ? (
            <div className="ce-hint">Reading the card…</div>
          ) : formExpanded ? (
            <>
              <div className="ce-grid ce-grid-2">
                <Field label="Card type">
                  <select
                    value={meta.type}
                    onChange={(e) => updateMeta("type", e.target.value as CardType)}
                    className={autofilled.type ? "ce-autofilled" : ""}
                  >
                    {CARD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t || "— Select —"}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Year">
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="e.g. 1999"
                    value={meta.year}
                    onChange={(e) => updateMeta("year", e.target.value)}
                    className={autofilled.year ? "ce-autofilled" : ""}
                  />
                </Field>
                <Field label="Player / Character">
                  <input
                    type="text"
                    placeholder="e.g. Charizard, Gretzky"
                    value={meta.name}
                    onChange={(e) => updateMeta("name", e.target.value)}
                    className={autofilled.name ? "ce-autofilled" : ""}
                  />
                </Field>
                <Field label="Set / Brand">
                  <input
                    type="text"
                    placeholder="e.g. Base Set, Topps"
                    value={meta.set}
                    onChange={(e) => updateMeta("set", e.target.value)}
                    className={autofilled.set ? "ce-autofilled" : ""}
                  />
                </Field>
                <Field label="Card # (if visible)">
                  <input
                    type="text"
                    placeholder="e.g. 4/102"
                    value={meta.number}
                    onChange={(e) => updateMeta("number", e.target.value)}
                    className={autofilled.number ? "ce-autofilled" : ""}
                  />
                </Field>
                <Field label="Already graded?">
                  <select
                    value={meta.graded}
                    onChange={(e) => updateMeta("graded", e.target.value as GradedKind)}
                    className={autofilled.graded ? "ce-autofilled" : ""}
                  >
                    <option value="">No / Raw</option>
                    {GRADED_KINDS.filter((g) => g).map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Your observations (optional)" style={{ marginTop: 10 }}>
                <textarea
                  placeholder="Sharp corners, slight off-center, surface scratch on the right…"
                  value={meta.notes}
                  onChange={(e) => updateMeta("notes", e.target.value)}
                />
              </Field>
              {identStatus?.tone !== "err" && (
                <div style={{ marginTop: 10, textAlign: "right" }}>
                  <button className="ce-small-link" onClick={() => setFormExpanded(false)}>
                    Done editing
                  </button>
                </div>
              )}
            </>
          ) : (
            <IdentSummary meta={meta} onEdit={() => setFormExpanded(true)} />
          )}
        </section>

        <div className="ce-actions">
          <button className="ce-primary" onClick={onEvaluate} disabled={!bothPhotos || evaluating}>
            {evaluating ? "Evaluating…" : "Evaluate card"}
          </button>
          <button className="ce-secondary" onClick={reset}>
            Reset
          </button>
        </div>

        {evaluating && (
          <section className="ce-card">
            <div className="ce-loading">
              <span className="ce-spinner" />
              <span>Evaluating card…</span>
            </div>
          </section>
        )}

        {error && (
          <section className="ce-card">
            <div className="ce-error">{error}</div>
          </section>
        )}

        {result && !evaluating && (
          <section className="ce-card">
            <div className="ce-result-header">
              <div className="ce-grade-circle">
                <div className="num">{fmtGrade(result.overall_grade)}</div>
                <div className="lbl">/ 10</div>
              </div>
              <div className="ce-grade-info">
                <div className="title">{resultTitle || "—"}</div>
                <div className="meta">{resultSubtitle}</div>
                <div className="ce-pill-row">
                  {result.grade_label && <span className="ce-pill green">{result.grade_label}</span>}
                  {result.authenticity_confidence && (
                    <span
                      className={
                        "ce-pill " +
                        (result.authenticity_confidence === "High"
                          ? "green"
                          : result.authenticity_confidence === "Low"
                          ? "red"
                          : "amber")
                      }
                    >
                      Auth: {result.authenticity_confidence}
                    </span>
                  )}
                </div>
                {(() => {
                  const r = spreadRange(result.runs?.overall_grade);
                  if (!r) return null;
                  return (
                    <div className="ce-spread-note">
                      Range across {result.runs?.count ?? 0} runs:{" "}
                      {fmtGrade(r.lo)}–{fmtGrade(r.hi)}
                    </div>
                  );
                })()}
              </div>
            </div>

            <div className="ce-section-title" style={{ marginTop: 4 }}>
              Condition scales
            </div>
            <div className="ce-scales">
              {(
                [
                  ["Centering", "centering"],
                  ["Corners", "corners"],
                  ["Edges", "edges"],
                  ["Surface", "surface"],
                ] as const
              ).map(([label, key]) => {
                const v = result.scales[key];
                const pct = v == null ? 0 : Math.max(0, Math.min(100, v * 10));
                const range = spreadRange(result.runs?.scales?.[key]);
                return (
                  <div className="ce-scale-row" key={key}>
                    <div className="name">
                      <span>{label}</span>
                      <b>
                        {v == null ? "—" : Math.round(v * 10) / 10}/10
                        {range && (
                          <span className="ce-scale-spread">
                            {" "}({fmtGrade(range.lo)}–{fmtGrade(range.hi)})
                          </span>
                        )}
                      </b>
                    </div>
                    <div className="ce-scale-bar">
                      <div className="fill" style={{ width: pct + "%" }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="ce-section-title" style={{ marginTop: 16 }}>
              Estimated value (USD)
            </div>
            <div className="ce-valuation">
              <ValBox label="Low" amount={result.valuation_usd.low} range={spreadRange(result.runs?.valuation_usd?.low)} />
              <ValBox label="Mid" amount={result.valuation_usd.mid} range={spreadRange(result.runs?.valuation_usd?.mid)} highlighted />
              <ValBox label="High" amount={result.valuation_usd.high} range={spreadRange(result.runs?.valuation_usd?.high)} />
            </div>

            <ResultList title="Highlights" items={result.highlights} />
            <ResultList title="Concerns" items={result.concerns} />
            <ResultList title="Recommendations" items={result.recommendations} />

            <div className="ce-result-footer">
              {result.runs?.count && result.runs.count > 1 ? (
                <span className="ce-runs-note">Averaged across {result.runs.count} model runs.</span>
              ) : (
                <span />
              )}
              <button className="ce-small-link" onClick={onSaveHistory}>
                Save to history
              </button>
            </div>
          </section>
        )}

        <section className="ce-card">
          <div className="ce-section-row">
            <div className="ce-section-title" style={{ marginBottom: 0 }}>
              History
            </div>
            {history.length > 0 && (
              <button className="ce-small-link" onClick={clearHistory}>
                Clear
              </button>
            )}
          </div>
          <div style={{ marginTop: 10 }}>
            {history.length === 0 ? (
              <div className="ce-history-empty">No evaluations saved yet.</div>
            ) : (
              history.map((item) => {
                const id = item.result.identification;
                const titleBits = [id.year, id.player_or_character].filter(Boolean);
                const title = titleBits.join(" · ") || item.meta.name || "Card";
                const sub = [id.type || item.meta.type, id.set || item.meta.set].filter(Boolean).join(" · ") ||
                  new Date(item.savedAt).toLocaleString();
                return (
                  <button
                    key={item.savedAt}
                    onClick={() => openHistory(item)}
                    className="ce-history-item"
                    type="button"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img alt="" src={item.thumb} />
                    <div className="info">
                      <div className="t">{title}</div>
                      <div className="m">{sub}</div>
                    </div>
                    <div className="ce-grade-mini">{fmtGrade(item.result.overall_grade)}</div>
                  </button>
                );
              })
            )}
          </div>
        </section>
      </main>
    </>
  );
}

// ---------- Sub-components ----------
function PhotoStrip({
  label,
  images,
  onAdd,
  onRemove,
  max,
}: {
  label: string;
  images: ProcessedImage[];
  onAdd: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: (idx: number) => void;
  max: number;
}) {
  const canAdd = images.length < max;
  return (
    <div className="ce-strip">
      <div className="ce-strip-header">
        <span className="ce-strip-label">{label}</span>
        <span className="ce-strip-count">
          {images.length}/{max}
        </span>
      </div>
      <div className="ce-strip-photos">
        {images.map((img, idx) => (
          <div className="ce-thumb has-image" key={idx}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt={`${label} ${idx + 1}`} src={img.sendUrl} />
            <button
              type="button"
              aria-label={`Remove ${label} photo ${idx + 1}`}
              onClick={() => onRemove(idx)}
              className="ce-clear-btn"
            >
              ×
            </button>
          </div>
        ))}
        {canAdd && (
          <label className={"ce-thumb ce-thumb-add" + (images.length === 0 ? " first" : "")}>
            <span className="ce-thumb-add-icon">📷</span>
            <span className="ce-thumb-add-text">
              {images.length === 0 ? "Tap to add photo" : "Add another"}
            </span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={onAdd}
              style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
            />
          </label>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  style,
}: {
  label: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div className="ce-field" style={style}>
      <label>{label}</label>
      {children}
    </div>
  );
}

function ValBox({
  label,
  amount,
  range,
  highlighted,
}: {
  label: string;
  amount: number | null;
  range?: { lo: number; hi: number } | null;
  highlighted?: boolean;
}) {
  return (
    <div className={"ce-val-box" + (highlighted ? " mid" : "")}>
      <div className="lbl">{label}</div>
      <div className="amt">{fmtMoney(amount)}</div>
      {range && (
        <div className="ce-val-range">
          {fmtMoney(range.lo)}–{fmtMoney(range.hi)}
        </div>
      )}
    </div>
  );
}

function IdentSummary({ meta, onEdit }: { meta: Meta; onEdit: () => void }) {
  const bits = [
    meta.year,
    meta.name,
    meta.type,
    meta.set,
    meta.number ? `#${meta.number}` : "",
    meta.graded || "",
  ].filter(Boolean);
  const nothing = bits.length === 0;
  return (
    <div className="ce-ident-summary">
      <div className="ce-ident-summary-text">
        {nothing ? (
          <span className="ce-ident-summary-empty">
            Couldn't make out card details. Tap edit to fill them in.
          </span>
        ) : (
          bits.map((b, i) => (
            <span key={i} className="ce-ident-chip">
              {b}
            </span>
          ))
        )}
      </div>
      <button type="button" className="ce-small-link" onClick={onEdit}>
        Edit
      </button>
    </div>
  );
}

function ResultList({ title, items }: { title: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <>
      <div className="ce-section-title" style={{ marginTop: 12 }}>
        {title}
      </div>
      <ul className="ce-list">
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </>
  );
}

// ---------- Styles (scoped via class prefix) ----------
const styles = `
  .ce-root { color-scheme: light; max-width: 720px; margin: 0 auto; padding: 16px 16px 48px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #1a1a1a; background: transparent; -webkit-font-smoothing: antialiased; }
  .ce-root * { box-sizing: border-box; }
  .ce-h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: -0.02em; }
  .ce-sub { color: #6b6b6b; font-size: 13px; margin: 0 0 18px; }
  .ce-card { background: #fff; border: 1px solid #e7e3dc; border-radius: 14px; padding: 16px; margin-bottom: 14px; box-shadow: 0 1px 0 rgba(0,0,0,0.02); }
  .ce-section-title { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #8a8a8a; margin: 0 0 10px; font-weight: 600; }
  .ce-section-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 10px; }

  .ce-strip-hint { color: #6b6b6b; font-size: 12.5px; margin: -4px 0 12px; line-height: 1.45; }
  .ce-strip { margin-bottom: 12px; }
  .ce-strip:last-child { margin-bottom: 0; }
  .ce-strip-header { display: flex; justify-content: space-between; align-items: baseline; margin: 0 2px 6px; }
  .ce-strip-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #4a4a4a; font-weight: 600; }
  .ce-strip-count { font-size: 11px; color: #9a948a; font-variant-numeric: tabular-nums; }
  .ce-strip-photos { display: flex; flex-wrap: wrap; gap: 8px; }
  .ce-thumb { position: relative; width: 92px; aspect-ratio: 3 / 4; background: #fafaf7; border: 1px solid #c8c2b3; border-radius: 10px; overflow: hidden; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .ce-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .ce-thumb-add { border: 1.5px dashed #d6d1c6; cursor: pointer; color: #9a948a; text-align: center; padding: 8px; }
  .ce-thumb-add.first { width: 100%; max-width: 240px; aspect-ratio: 3 / 4; }
  .ce-thumb-add-icon { font-size: 24px; display: block; margin-bottom: 4px; }
  .ce-thumb-add-text { font-size: 11.5px; line-height: 1.25; pointer-events: none; }
  .ce-clear-btn { position: absolute; top: 4px; right: 4px; background: rgba(0,0,0,0.6); color: #fff; border: none; border-radius: 999px; width: 22px; height: 22px; font-size: 13px; cursor: pointer; z-index: 3; display: flex; align-items: center; justify-content: center; padding: 0; line-height: 1; }

  .ce-grid { display: grid; gap: 10px; }
  .ce-grid-2 { grid-template-columns: 1fr 1fr; }

  .ce-field { display: flex; flex-direction: column; gap: 4px; }
  .ce-field > label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #8a8a8a; font-weight: 600; }
  .ce-field input, .ce-field select, .ce-field textarea {
    border: 1px solid #e0dccf; background: #fcfbf8; border-radius: 10px; padding: 10px 12px;
    font-size: 15px; font-family: inherit; color: #1a1a1a; outline: none;
    transition: border-color 0.15s, background 0.15s; width: 100%;
  }
  .ce-field input:focus, .ce-field select:focus, .ce-field textarea:focus { border-color: #b4a98f; background: #fff; }
  .ce-field textarea { resize: vertical; min-height: 64px; }
  .ce-autofilled { background: #f3f7eb !important; border-color: #c9d8a7 !important; }

  .ce-actions { display: flex; gap: 10px; margin-top: 14px; }
  .ce-primary { flex: 1; background: #1f1f1f; color: #fff; border: none; border-radius: 12px; padding: 14px 16px; font-size: 16px; font-weight: 600; cursor: pointer; letter-spacing: -0.01em; }
  .ce-primary:disabled { background: #cfcabf; cursor: not-allowed; }
  .ce-secondary { background: #f0ece3; color: #1a1a1a; border: none; border-radius: 12px; padding: 14px 16px; font-size: 15px; font-weight: 500; cursor: pointer; }

  .ce-loading { display: flex; align-items: center; gap: 10px; padding: 14px; color: #6b6b6b; font-size: 14px; }
  .ce-spinner { width: 18px; height: 18px; border-radius: 50%; border: 2px solid #d6d1c6; border-top-color: #1a1a1a; animation: ce-spin 0.8s linear infinite; }
  @keyframes ce-spin { to { transform: rotate(360deg); } }

  .ce-error { background: #fdebe5; border: 1px solid #f5c6b3; color: #80371f; padding: 12px 14px; border-radius: 10px; font-size: 14px; }

  .ce-ident-status { font-size: 12px; color: #8a8a8a; display: inline-flex; align-items: center; gap: 6px; }
  .ce-ident-status.done { color: #4a6a2e; }
  .ce-ident-status.err  { color: #80371f; }
  .ce-mini-spin { width: 12px; height: 12px; border-radius: 50%; border: 2px solid #e7e3dc; border-top-color: #1a1a1a; animation: ce-spin 0.8s linear infinite; display: inline-block; }

  .ce-result-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
  .ce-grade-circle { width: 84px; height: 84px; border-radius: 50%; background: linear-gradient(135deg, #1a1a1a, #3a3a3a); color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
  .ce-grade-circle .num { font-size: 30px; font-weight: 700; line-height: 1; letter-spacing: -0.03em; }
  .ce-grade-circle .lbl { font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; margin-top: 4px; opacity: 0.85; }
  .ce-grade-info { flex: 1; min-width: 0; }
  .ce-grade-info .title { font-size: 17px; font-weight: 600; line-height: 1.25; }
  .ce-grade-info .meta { font-size: 13px; color: #6b6b6b; margin-top: 2px; }

  .ce-pill-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .ce-pill { font-size: 11px; padding: 4px 10px; background: #f0ece3; color: #4a4a4a; border-radius: 999px; letter-spacing: 0.02em; }
  .ce-pill.green { background: #e6efd9; color: #4a6a2e; }
  .ce-pill.amber { background: #fbedd0; color: #7a5400; }
  .ce-pill.red   { background: #f6dcd4; color: #80371f; }

  .ce-scales { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; margin-top: 6px; }
  .ce-scale-row { font-size: 13px; }
  .ce-scale-row .name { display: flex; justify-content: space-between; margin-bottom: 4px; color: #4a4a4a; }
  .ce-scale-row .name b { color: #1a1a1a; font-variant-numeric: tabular-nums; }
  .ce-scale-bar { height: 6px; background: #eee5d4; border-radius: 999px; overflow: hidden; }
  .ce-scale-bar .fill { height: 100%; background: linear-gradient(90deg, #c79b56, #6a8a5f); border-radius: 999px; transition: width 0.5s ease; }

  .ce-valuation { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 10px; }
  .ce-val-box { background: #f7f3e9; border: 1px solid #ece4cf; border-radius: 10px; padding: 10px 8px; text-align: center; }
  .ce-val-box .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #8a8a8a; }
  .ce-val-box .amt { font-size: 18px; font-weight: 600; margin-top: 2px; font-variant-numeric: tabular-nums; }
  .ce-val-box.mid { background: #1f1f1f; color: #fff; border-color: #1f1f1f; }
  .ce-val-box.mid .lbl { color: #c4c4c4; }
  .ce-val-range { font-size: 10.5px; color: #8a8a8a; margin-top: 3px; font-variant-numeric: tabular-nums; }
  .ce-val-box.mid .ce-val-range { color: #b8b3a4; }

  .ce-scale-spread { font-weight: 400; color: #8a8a8a; font-size: 12px; }
  .ce-spread-note { font-size: 11.5px; color: #8a8a8a; margin-top: 8px; }
  .ce-result-footer { margin-top: 14px; display: flex; justify-content: space-between; align-items: center; gap: 10px; }
  .ce-runs-note { font-size: 11.5px; color: #8a8a8a; }

  .ce-hint { color: #9a948a; font-size: 13px; text-align: center; padding: 6px 8px 2px; }
  .ce-ident-summary { display: flex; gap: 10px; align-items: center; justify-content: space-between; padding: 4px 0 2px; }
  .ce-ident-summary-text { display: flex; flex-wrap: wrap; gap: 6px; flex: 1; min-width: 0; }
  .ce-ident-summary-empty { font-size: 13px; color: #9a948a; }
  .ce-ident-chip { font-size: 13px; background: #f3f7eb; color: #4a6a2e; padding: 4px 10px; border-radius: 999px; border: 1px solid #d9e6c1; }

  .ce-list { margin: 0; padding-left: 18px; }
  .ce-list li { font-size: 13.5px; line-height: 1.5; margin-bottom: 4px; }

  .ce-small-link { background: none; border: none; color: #6b6b6b; font-size: 12px; padding: 4px 8px; cursor: pointer; text-decoration: underline; }

  .ce-history-empty { color: #9a948a; font-size: 13px; text-align: center; padding: 12px; }
  .ce-history-item { display: flex; gap: 10px; padding: 10px; background: #fafaf7; border: 1px solid #ece8df; border-radius: 10px; margin-bottom: 8px; cursor: pointer; align-items: center; width: 100%; text-align: left; font: inherit; color: inherit; }
  .ce-history-item img { width: 44px; height: 60px; object-fit: cover; border-radius: 6px; flex-shrink: 0; background: #eee; }
  .ce-history-item .info { flex: 1; min-width: 0; }
  .ce-history-item .info .t { font-size: 14px; font-weight: 500; color: #1a1a1a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ce-history-item .info .m { font-size: 12px; color: #8a8a8a; margin-top: 2px; }
  .ce-grade-mini { font-size: 13px; font-weight: 600; padding: 4px 10px; background: #1f1f1f; color: #fff; border-radius: 999px; }

  @media (max-width: 420px) {
    .ce-root { padding: 12px 12px 40px; }
    .ce-grade-circle { width: 72px; height: 72px; }
    .ce-grade-circle .num { font-size: 26px; }
    .ce-scales { grid-template-columns: 1fr; }
  }
`;
