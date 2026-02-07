#!/usr/bin/env python3
"""
Rigorous simulation runner for Curriculate /api/ai/tasksets.

Runs:
- TYPE_MODE=full (default): 1 request asks for all TASK_TYPES (demo-like).
- TYPE_MODE=single: each iteration runs 1 request per type (slow, max diagnosis).

Outputs written to OUT_DIR (default: sim_out):
- results.jsonl: one JSON record per run
- failures_by_type.json: taskType -> top error strings
- latency.json: raw latency arrays
- summary.json: high-level metrics + top failure types + retry attempt stats (if provided)

Env:
  CURRICULATE_TOKEN   (required)  Bearer token value (NOT including 'Bearer ')
  CURRICULATE_API_BASE (optional) https://api.curriculate.net
  SIM_N (optional) default 100
  SIM_SEED (optional) default now
  TYPE_MODE (optional) full|single
  OUT_DIR (optional) sim_out
"""
import os, time, json, random, statistics
from collections import defaultdict, Counter
from pathlib import Path

import requests

API_BASE = os.environ.get("CURRICULATE_API_BASE", "https://api.curriculate.net").rstrip("/")
TOKEN = os.environ.get("CURRICULATE_TOKEN")
if not TOKEN:
    raise SystemExit("Set CURRICULATE_TOKEN env var (Bearer token value only; do NOT include the 'Bearer ' prefix).")

TYPE_MODE = os.environ.get("TYPE_MODE", "full").strip().lower()  # full | single
N = int(os.environ.get("SIM_N", "100"))
SEED = int(os.environ.get("SIM_SEED", str(int(time.time()))))
OUT_DIR = Path(os.environ.get("OUT_DIR", "sim_out"))
OUT_DIR.mkdir(parents=True, exist_ok=True)

URL = f"{API_BASE}/api/ai/tasksets?token={TOKEN}"
HEADERS = {
    "Content-Type": "application/json",
}

TASK_TYPES = [
  "multiple-choice","physical-multiple-choice","true-false","short-answer","reading-comp","sort","sequence","timeline",
  "matching","open-text","photo","make-and-snap","photo-journal","body-break","motion-mission","musical-chairs",
  "mad-dash-sequence","hidenseek","brain-blitz","true-false-tictactoe","flashcards","flashcards-race","guess-who",
  "hangman-duel","word-weaver-duel","pet-feeding","collaboration","live-debate","brainstorm-battle","fake-out",
  "brain-spark-notes","mind-mapper","narration-synthesize","role-play-deck","script-play","echo-chain",
  "pronunciation","speech-recognition",
]

TOPICS = [
  ("History", "Confederation of Canada", ["Confederation","Dominion","Province","Federal government"]),
  ("Geography", "Rivers of the World", ["tributary","watershed","delta","erosion"]),
  ("Science", "Photosynthesis", ["chlorophyll","glucose","carbon dioxide","oxygen"]),
  ("Math", "Fractions", ["numerator","denominator","equivalent","simplify"]),
  ("Bible", "Parables of Jesus", ["parable","kingdom","repentance","mercy"]),
  ("ELA", "Figurative Language", ["metaphor","simile","alliteration","imagery"]),
  ("Civics", "Levels of Government", ["municipal","provincial","federal","jurisdiction"]),
  ("History", "World War I", ["trench","armistice","alliance","mobilization"]),
]

DIFFICULTIES = ["EASY","MEDIUM","HARD"]
LEARNING_GOALS = ["REVIEW","INTRODUCTION","ENRICHMENT","ASSESSMENT"]

def make_payload(types):
    """
    Align payload with backend/controllers/mainTasksetController.js

    Expected fields (per controller):
      - title (optional but recommended)
      - subject, gradeLevel, difficulty, learningGoal
      - topicLabel (NOT topicTitle)
      - aiWordBank
      - taskTypePool, count

    Also note: controller clamps count to max 30. So we must not request more than 30
    tasks in a single "full" request.
    """
    subject, topicLabel, wordbank = random.choice(TOPICS)

    # mainTasksetController clamps count to [1..30]
    max_count = 30
    requested_types = list(types)[:max_count]
    safe_count = len(requested_types)

    return {
        "title": f"{subject} — {topicLabel}",
        "taskTypePool": requested_types,
        "count": safe_count,
        "subject": subject,
        "gradeLevel": 7,
        "difficulty": random.choice(DIFFICULTIES),
        "learningGoal": random.choice(LEARNING_GOALS),
        "topicLabel": topicLabel,
        "aiWordBank": wordbank,
    }

def post(payload, timeout=240):
    t0 = time.time()
    r = requests.post(URL, headers=HEADERS, json=payload, timeout=timeout)
    ms = int((time.time() - t0) * 1000)
    try:
        data = r.json()
    except Exception:
        data = {"raw": (r.text or "")[:4000]}
    return r.status_code, ms, data

def percentile(vals, p):
    """
    Robust percentile with clamped indices.
    Returns None for empty input.
    """
    if not vals:
        return None
    vals_sorted = sorted(vals)
    n = len(vals_sorted)
    if n == 1:
        return vals_sorted[0]

    # Clamp p to [0, 100]
    p = 0.0 if p < 0 else 100.0 if p > 100 else float(p)

    k = (n - 1) * (p / 100.0)
    f = int(k)
    c = f + 1
    if f < 0:
        f = 0
    if f > n - 1:
        f = n - 1
    if c > n - 1:
        c = n - 1

    if f == c:
        return vals_sorted[f]

    return int(vals_sorted[f] + (vals_sorted[c] - vals_sorted[f]) * (k - f))


def harvest_details(resp):
    """
    Controller patch may return:
      - details: { taskType: "reason" }
      - perType: { taskType: { ok, attempts, error } }  (optional)
    Normalize into:
      details_map, attempts_map
    """
    details_map = {}
    attempts_map = {}
    if not isinstance(resp, dict):
        return details_map, attempts_map

    if isinstance(resp.get("details"), dict):
        for k, v in resp["details"].items():
            details_map[str(k)] = str(v)

    # Some controller variants attach per-type diagnostics at top-level perType
    if isinstance(resp.get("perType"), dict):
        for k, info in resp["perType"].items():
            if isinstance(info, dict):
                if info.get("error"):
                    details_map.setdefault(str(k), str(info["error"]))
                if isinstance(info.get("attempts"), int):
                    attempts_map[str(k)] = info["attempts"]

    # Some newer controllers include diagnostics under resp.telemetry
    telem = resp.get("telemetry") if isinstance(resp.get("telemetry"), dict) else None
    if isinstance(telem, dict) and isinstance(telem.get("perType"), dict):
        for k, info in telem["perType"].items():
            if isinstance(info, dict):
                if info.get("error"):
                    details_map.setdefault(str(k), str(info["error"]))
                if isinstance(info.get("attempts"), int):
                    attempts_map.setdefault(str(k), info["attempts"])

    # Back-compat parse for classic strings
    err = resp.get("error") if isinstance(resp.get("error"), str) else ""
    if "AI task schema invalid for " in err:
        try:
            frag = err.split("AI task schema invalid for ", 1)[1]
            t = frag.split(":", 1)[0].strip()
            msg = frag.split(":", 1)[1].strip() if ":" in frag else ""
            details_map.setdefault(t, msg or err)
        except Exception:
            pass

    return details_map, attempts_map

def main():
    random.seed(SEED)

    results_jsonl = OUT_DIR / "results.jsonl"
    summary_json = OUT_DIR / "summary.json"
    failures_by_type_json = OUT_DIR / "failures_by_type.json"
    latency_json = OUT_DIR / "latency.json"

    totals = Counter()
    failures_by_type = defaultdict(Counter)
    attempts_by_type = defaultdict(list)
    lat_all, lat_ok, lat_fail = [], [], []

    with results_jsonl.open("w", encoding="utf-8") as fjsonl:
        for i in range(1, N+1):
            if TYPE_MODE == "single":
                subject, topicLabel, wordbank = random.choice(TOPICS)
                base = {
                    "title": f"{subject} — {topicLabel}",
                    "subject": subject,
                    "gradeLevel": 7,
                    "difficulty": random.choice(DIFFICULTIES),
                    "learningGoal": random.choice(LEARNING_GOALS),
                    "topicLabel": topicLabel,
                    "aiWordBank": wordbank,
                }
                iter_ok = True
                iter_details, iter_attempts = {}, {}
                iter_ms = 0

                for t in TASK_TYPES:
                    payload = dict(base, taskTypePool=[t], count=1)
                    status, ms, resp = post(payload, timeout=180)
                    iter_ms += ms
                    ok = (status == 200 and isinstance(resp, dict) and resp.get("ok") is True)
                    if not ok:
                        iter_ok = False
                        dmap, amap = harvest_details(resp)
                        if not dmap:
                            dmap = {t: resp.get("error", f"HTTP {status}")}
                        for k, v in dmap.items():
                            iter_details.setdefault(k, v)
                        for k, v in amap.items():
                            iter_attempts.setdefault(k, v)

                status, ms, resp = (200 if iter_ok else 400), iter_ms, {"ok": iter_ok, "details": iter_details, "perType": {k: {"attempts": v} for k, v in iter_attempts.items()}}
                # For logging only; full requests are clamped to 30 by the controller.
                payload = dict(base, taskTypePool=list(TASK_TYPES)[:30], count=min(len(TASK_TYPES), 30))

            else:
                payload = make_payload(TASK_TYPES)
                status, ms, resp = post(payload, timeout=300)

            ok = (status == 200 and isinstance(resp, dict) and resp.get("ok") is True)

            lat_all.append(ms)
            (lat_ok if ok else lat_fail).append(ms)

            if ok:
                totals["runs_ok"] += 1
                tasks = ((resp.get("taskset") or {}).get("tasks") or [])
                totals["tasks_total_returned"] += len(tasks)
            else:
                totals["runs_fail"] += 1
                details_map, attempts_map = harvest_details(resp)
                if details_map:
                    for t, msg in details_map.items():
                        failures_by_type[t][msg] += 1
                else:
                    failures_by_type["_request"][str(resp.get("error", f"HTTP {status}"))] += 1
                for t, a in attempts_map.items():
                    attempts_by_type[t].append(a)

            fjsonl.write(json.dumps({
                "run": i,
                "seed": SEED,
                "mode": TYPE_MODE,
                "http_status": status,
                "ms": ms,
                "ok": ok,
                "payload": payload,
                "response": resp,
            }) + "\n")

            print(f"[{i}/{N}] ok={ok} status={status} ms={ms} topic={payload.get('topicTitle')}")

    totals["runs_total"] = N
    totals["ok_rate"] = round((totals["runs_ok"] / N) if N else 0.0, 4)
    totals["latency_ms_p50"] = percentile(lat_all, 50)
    totals["latency_ms_p95"] = percentile(lat_all, 95)
    totals["latency_ms_ok_p95"] = percentile(lat_ok, 95)
    totals["latency_ms_fail_p95"] = percentile(lat_fail, 95)

    attempts_stats = {}
    for t, vals in attempts_by_type.items():
        if vals:
            attempts_stats[t] = {
                "n": len(vals),
                "avg": round(statistics.mean(vals), 3),
                "p95": percentile(vals, 95),
                "max": max(vals),
            }

    with failures_by_type_json.open("w", encoding="utf-8") as f:
        json.dump({k: v.most_common(20) for k, v in failures_by_type.items()}, f, indent=2)

    with latency_json.open("w", encoding="utf-8") as f:
        json.dump({"all_ms": lat_all, "ok_ms": lat_ok, "fail_ms": lat_fail}, f, indent=2)

    with summary_json.open("w", encoding="utf-8") as f:
        json.dump({
            **totals,
            "attempts_by_type": attempts_stats,
            "top_failure_types": sorted(
                [(t, sum(c.values())) for t, c in failures_by_type.items() if t != "_request"],
                key=lambda x: x[1], reverse=True
            )[:15],
        }, f, indent=2)

    print("\nWrote outputs to:", OUT_DIR.resolve())
    print(" - results.jsonl")
    print(" - failures_by_type.json")
    print(" - latency.json")
    print(" - summary.json")

if __name__ == "__main__":
    main()
