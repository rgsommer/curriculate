#!/usr/bin/env python3
"""
Curriculate Practice Feedback Utility
Run from the project root:  python feedback.py
"""

import os, sys, urllib.request, urllib.error, json

API_BASE = os.environ.get("API_BASE", "https://api.curriculate.net")
TOKEN_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".feedback-token")

def load_token():
    """Load token from env, .feedback-token file, or .env file."""
    # 1. Environment variable
    t = os.environ.get("ADMIN_API_TOKEN", "").strip()
    if t:
        return t
    # 2. Saved token file
    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE) as f:
            t = f.read().strip()
            if t:
                return t
    # 3. .env file
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("ADMIN_API_TOKEN="):
                    t = line.split("=", 1)[1].strip().strip('"').strip("'")
                    if t:
                        return t
    return ""

def save_token(token):
    """Save token to .feedback-token for future runs."""
    with open(TOKEN_FILE, "w") as f:
        f.write(token.strip())
    print(f"Token saved to .feedback-token")

def get_token(force_prompt=False):
    """Get token, prompting if missing."""
    if not force_prompt:
        t = load_token()
        if t:
            return t
    t = input("Enter your ADMIN_API_TOKEN: ").strip()
    if t:
        save_token(t)
    return t

def pull_feedback():
    """Download the feedback report and save to feedback-report.txt"""
    token = get_token()
    if not token:
        print("No token provided.")
        return
    url = f"{API_BASE}/api/conference/feedback-export?key={token}"
    print(f"\nFetching feedback from {API_BASE} ...")
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = resp.read().decode("utf-8")
        out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "feedback-report.txt")
        with open(out, "w") as f:
            f.write(body)
        lines = body.strip().split("\n")
        print(f"Saved to feedback-report.txt ({len(lines)} lines)\n")
        print(body)
    except urllib.error.HTTPError as e:
        print(f"Error {e.code}: {e.read().decode()}")
    except Exception as e:
        print(f"Failed: {e}")

def clear_feedback():
    """Clear all feedback from the database so the report starts fresh"""
    token = get_token()
    if not token:
        print("No token provided.")
        return
    url = f"{API_BASE}/api/conference/feedback-clear?key={token}"
    print(f"\nClearing feedback at {API_BASE} ...")
    confirm = input("Are you sure? This removes ALL practice feedback. (yes/no): ").strip().lower()
    if confirm not in ("yes", "y"):
        print("Cancelled.")
        return
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if data.get("ok"):
            print(f"Done! Cleared feedback from {data.get('modifiedCount', '?')} student sessions.")
        else:
            print(f"Unexpected response: {data}")
    except urllib.error.HTTPError as e:
        print(f"Error {e.code}: {e.read().decode()}")
    except Exception as e:
        print(f"Failed: {e}")

def update_token():
    """Prompt for a new token and save it."""
    current = load_token()
    if current:
        masked = current[:4] + "..." + current[-4:] if len(current) > 8 else "****"
        print(f"\nCurrent token: {masked}")
    get_token(force_prompt=True)
    print("Token updated.")

def show_menu():
    token = load_token()
    status = "set" if token else "not set"
    print(f"\n╔══════════════════════════════════════╗")
    print(f"║   Curriculate Feedback Utility       ║")
    print(f"╠══════════════════════════════════════╣")
    print(f"║  1. Pull feedback report             ║")
    print(f"║  2. Clear all feedback               ║")
    print(f"║  3. Update API token  ({status:>7})     ║")
    print(f"║  4. Exit                             ║")
    print(f"╚══════════════════════════════════════╝")

if __name__ == "__main__":
    # Allow direct command: python feedback.py pull | clear
    if len(sys.argv) > 1:
        cmd = sys.argv[1].lower()
        if cmd == "pull":
            pull_feedback()
        elif cmd == "clear":
            clear_feedback()
        elif cmd == "token":
            update_token()
        else:
            print(f"Unknown command: {cmd}\nUsage: python feedback.py [pull|clear|token]")
        sys.exit(0)

    while True:
        show_menu()
        choice = input("\nChoice (1-4): ").strip()
        if choice == "1":
            pull_feedback()
        elif choice == "2":
            clear_feedback()
        elif choice == "3":
            update_token()
        elif choice == "4":
            print("Bye!")
            break
        else:
            print("Pick 1-4.")
