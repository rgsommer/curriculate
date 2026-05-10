#!/usr/bin/env python3
"""
Curriculate Feedback Utility — pulls bug reports + suggestions for any
of the three products into product-specific files at the repo root:

    feedback-curriculate.txt   (student practice / scavenger hunts)
    feedback-fieldday.txt      (Field Day app)
    feedback-grading.txt       (Pulse Grading — when wired up backend-side)

Run from the project root:
    python feedback.py             (interactive menu)
    python feedback.py pull        (pull ALL three products)
    python feedback.py pull fieldday
    python feedback.py pull curriculate
    python feedback.py pull grading
    python feedback.py clear fieldday      (wipes everything)
    python feedback.py clear curriculate
    python feedback.py clear grading
    python feedback.py token

Token is read in this order: $ADMIN_API_TOKEN env var → ./.feedback-token
file → ./.env (looking for ADMIN_API_TOKEN=...). First time you run, you'll
be prompted; the token is then saved to .feedback-token for next time.
"""

import os, sys, urllib.request, urllib.error, urllib.parse, json

API_BASE   = os.environ.get("API_BASE", "https://api.curriculate.net")
ROOT_DIR   = os.path.dirname(os.path.abspath(__file__))
TOKEN_FILE = os.path.join(ROOT_DIR, ".feedback-token")

# Per-product configuration. Add new products here when their backend
# /feedback-export endpoints exist. Each has a unique export endpoint and
# a unique output file at the repo root.
PRODUCTS = {
    "curriculate": {
        "label":      "Curriculate (student practice / scavenger hunts)",
        "export_url": "/api/conference/feedback-export",
        "clear_url":  "/api/conference/feedback-clear",
        "out_file":   os.path.join(ROOT_DIR, "feedback-curriculate.txt"),
    },
    "fieldday": {
        "label":      "Field Day",
        "export_url": "/fieldday/api/feedback-export",
        "clear_url":  "/fieldday/api/feedback-clear",
        "out_file":   os.path.join(ROOT_DIR, "feedback-fieldday.txt"),
    },
    "grading": {
        "label":      "Pulse Grading",
        "export_url": "/api/grading/feedback-export",
        "clear_url":  "/api/grading/feedback-clear",
        "out_file":   os.path.join(ROOT_DIR, "feedback-grading.txt"),
    },
}

# ---------------------------------------------------------------- token --

def load_token():
    """Env > .feedback-token > .env, in that order."""
    t = os.environ.get("ADMIN_API_TOKEN", "").strip()
    if t: return t
    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE) as f:
            t = f.read().strip()
            if t: return t
    env_path = os.path.join(ROOT_DIR, ".env")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("ADMIN_API_TOKEN="):
                    t = line.split("=", 1)[1].strip().strip('"').strip("'")
                    if t: return t
    return ""

def save_token(token):
    with open(TOKEN_FILE, "w") as f:
        f.write(token.strip())
    print(f"Token saved to .feedback-token")

def get_token(force_prompt=False):
    if not force_prompt:
        t = load_token()
        if t: return t
    t = input("Enter your ADMIN_API_TOKEN: ").strip()
    if t: save_token(t)
    return t

def update_token():
    current = load_token()
    if current:
        masked = current[:4] + "..." + current[-4:] if len(current) > 8 else "****"
        print(f"\nCurrent token: {masked}")
    get_token(force_prompt=True)
    print("Token updated.")

# ----------------------------------------------------------------- core --

def _http_get(url):
    """GET a URL; return (status, body)."""
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status, resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")

def pull_one(product_key):
    """Pull feedback for ONE product into its output file."""
    cfg = PRODUCTS.get(product_key)
    if not cfg:
        print(f"Unknown product '{product_key}'. Choices: {', '.join(PRODUCTS)}")
        return False
    token = get_token()
    if not token:
        print("No token provided.")
        return False
    url = f"{API_BASE}{cfg['export_url']}?key={urllib.parse.quote(token)}"
    print(f"\n[{product_key:12}] Fetching from {API_BASE}{cfg['export_url']} ...")
    status, body = _http_get(url)
    if status == 404:
        print(f"  -> 404 — backend doesn't have this endpoint yet. Skipped.")
        return False
    if status == 401:
        print(f"  -> 401 unauthorized. Run `python feedback.py token` to update.")
        return False
    if status != 200 or not body.strip():
        print(f"  -> Unexpected status {status}: {body[:200]}")
        return False
    with open(cfg["out_file"], "w") as f:
        f.write(body)
    lines = body.strip().split("\n")
    rel = os.path.relpath(cfg["out_file"], ROOT_DIR)
    print(f"  -> Saved {rel} ({len(lines)} lines)")
    return True

def pull_all():
    """Pull for every configured product. Skips ones with no backend route yet."""
    print("Pulling feedback for all products...")
    ok = 0
    for k in PRODUCTS:
        if pull_one(k): ok += 1
    print(f"\nDone — {ok} of {len(PRODUCTS)} products pulled successfully.")

def clear_one(product_key):
    """Wipe ALL stored feedback for one product. Single confirmation, no
    triage statuses — every backend `/feedback-clear` endpoint nukes
    everything."""
    cfg = PRODUCTS.get(product_key)
    if not cfg:
        print(f"Unknown product '{product_key}'. Choices: {', '.join(PRODUCTS)}")
        return
    if not cfg.get("clear_url"):
        print(f"'{product_key}' has no clear endpoint configured.")
        return
    token = get_token()
    if not token:
        print("No token provided.")
        return

    confirm = input(
        f"\nReally wipe ALL {cfg['label']} feedback? (yes/no): "
    ).strip().lower()
    if confirm not in ("yes", "y"):
        print("Cancelled.")
        return

    url = f"{API_BASE}{cfg['clear_url']}?key={urllib.parse.quote(token)}"
    status, body = _http_get(url)
    if status == 200:
        try:
            data = json.loads(body)
            count = data.get("deletedCount") or data.get("modifiedCount") or "?"
            print(f"Done. Cleared {count}.")
        except Exception:
            print("Done.")
    else:
        print(f"Failed (status {status}): {body[:200]}")

# ----------------------------------------------------------------- menu --

def show_menu():
    token = load_token()
    status = "set" if token else "NOT SET"
    print()
    print("┌─────────────────────────────────────────────────┐")
    print("│      Curriculate Feedback Utility               │")
    print("├─────────────────────────────────────────────────┤")
    print("│   1. Pull ALL feedback                          │")
    print("│   2. Pull Curriculate (practice) feedback       │")
    print("│   3. Pull Field Day feedback                    │")
    print("│   4. Pull Pulse Grading feedback                │")
    print("│   5. Clear feedback (per product)               │")
    print(f"│   6. Update API token  ({status:>7})              │")
    print("│   7. Exit                                       │")
    print("└─────────────────────────────────────────────────┘")

def interactive():
    while True:
        show_menu()
        choice = input("\nChoice (1-7): ").strip()
        if   choice == "1": pull_all()
        elif choice == "2": pull_one("curriculate")
        elif choice == "3": pull_one("fieldday")
        elif choice == "4": pull_one("grading")
        elif choice == "5":
            print("\nWhich product to clear?")
            keys = list(PRODUCTS.keys())
            for i, k in enumerate(keys, 1):
                cap = "" if PRODUCTS[k].get("clear_url") else "  (no clear endpoint)"
                print(f"  {i}. {PRODUCTS[k]['label']}{cap}")
            sub = input("Choice: ").strip()
            if sub.isdigit() and 1 <= int(sub) <= len(keys):
                clear_one(keys[int(sub)-1])
        elif choice == "6": update_token()
        elif choice == "7": print("Bye!"); break
        else: print("Pick 1-7.")

# ---------------------------------------------------------------- main --

def main():
    if len(sys.argv) > 1:
        cmd = sys.argv[1].lower()
        arg = sys.argv[2].lower() if len(sys.argv) > 2 else None
        if cmd == "pull":
            if arg and arg in PRODUCTS: pull_one(arg)
            elif arg:                   print(f"Unknown product '{arg}'. Try: {', '.join(PRODUCTS)}")
            else:                       pull_all()
        elif cmd == "clear":
            if arg and arg in PRODUCTS: clear_one(arg)
            else:                       print(f"Usage: python feedback.py clear <{ '|'.join(PRODUCTS) }>")
        elif cmd == "token":
            update_token()
        else:
            print(f"Unknown command: {cmd}")
            print(f"Usage: python feedback.py [pull|clear|token] [product]")
            print(f"Products: {', '.join(PRODUCTS)}")
        return
    interactive()

if __name__ == "__main__":
    main()
