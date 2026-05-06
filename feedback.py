#!/usr/bin/env python3
"""
Curriculate Practice Feedback Utility
Run from the project root:  python feedback.py
"""

import os, sys, urllib.request, urllib.error, json

API_BASE = os.environ.get("API_BASE", "https://api.curriculate.net")
TOKEN = os.environ.get("ADMIN_API_TOKEN", "")

def get_token():
    global TOKEN
    if TOKEN:
        return TOKEN
    # Try .env file in current directory
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("ADMIN_API_TOKEN="):
                    TOKEN = line.split("=", 1)[1].strip().strip('"').strip("'")
                    return TOKEN
    # Ask the user
    TOKEN = input("Enter your ADMIN_API_TOKEN: ").strip()
    return TOKEN

def pull_feedback():
    """Download the feedback report and save to feedback-report.txt"""
    token = get_token()
    url = f"{API_BASE}/api/conference/feedback-export?key={token}"
    print(f"\nFetching feedback from {API_BASE} ...")
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = resp.read().decode("utf-8")
        out = os.path.join(os.path.dirname(__file__), "feedback-report.txt")
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

def show_menu():
    print("\n╔══════════════════════════════════════╗")
    print("║   Curriculate Feedback Utility       ║")
    print("╠══════════════════════════════════════╣")
    print("║  1. Pull feedback report             ║")
    print("║  2. Clear all feedback               ║")
    print("║  3. Exit                             ║")
    print("╚══════════════════════════════════════╝")

if __name__ == "__main__":
    # Allow direct command: python feedback.py pull | clear
    if len(sys.argv) > 1:
        cmd = sys.argv[1].lower()
        if cmd == "pull":
            pull_feedback()
        elif cmd == "clear":
            clear_feedback()
        else:
            print(f"Unknown command: {cmd}\nUsage: python feedback.py [pull|clear]")
        sys.exit(0)

    while True:
        show_menu()
        choice = input("\nChoice (1/2/3): ").strip()
        if choice == "1":
            pull_feedback()
        elif choice == "2":
            clear_feedback()
        elif choice == "3":
            print("Bye!")
            break
        else:
            print("Pick 1, 2, or 3.")
