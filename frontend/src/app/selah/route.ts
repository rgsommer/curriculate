import type { NextRequest } from "next/server";

// curriculate.net/selah — Selah one-line installer.
//
// Selah is a NATIVE Raspberry Pi app (pygame/camera/GPIO), not a web app, so
// this URL does not "serve" the display — it serves a bootstrap shell script
// that clones the repo and runs the real installer:
//
//   curl -sSL https://www.curriculate.net/selah | bash
//
// Override the source repo (e.g. an HTTPS+token URL or a fork):
//   curl -sSL https://www.curriculate.net/selah | SELAH_REPO=https://github.com/you/selah.git bash
//
// The script is intentionally brace-free ($VAR, never ${VAR}) so it survives
// living inside this template literal without JS interpolation.

const INSTALL_SCRIPT = `#!/usr/bin/env bash
set -eo pipefail

# ----- config (override via env before the pipe) -----
REPO="$SELAH_REPO";     [ -n "$REPO" ]   || REPO="https://github.com/rgsommer/selah.git"
DEST="$SELAH_DIR";      [ -n "$DEST" ]   || DEST="$HOME/selah_display"
BRANCH="$SELAH_BRANCH"; [ -n "$BRANCH" ] || BRANCH="main"

echo "== Selah installer =="
echo "Repo:   $REPO"
echo "Target: $DEST  (branch: $BRANCH)"

# ----- ensure git -----
if ! command -v git >/dev/null 2>&1; then
  echo "Installing git..."
  sudo apt-get update -qq
  sudo apt-get install -y git
fi

print_auth_help() {
  echo "" >&2
  echo "Could not access $REPO — it is private, so this Pi needs read access." >&2
  echo "Add an SSH deploy key (one time):" >&2
  echo "  ssh-keygen -t ed25519 -C selah-pi -f \\$HOME/.ssh/id_ed25519 -N ''" >&2
  echo "  cat \\$HOME/.ssh/id_ed25519.pub" >&2
  echo "  # paste it at: github.com/rgsommer/selah  ->  Settings  ->  Deploy keys (Allow read)" >&2
  echo "Then re-run this installer. Or pass an HTTPS token URL via SELAH_REPO=..." >&2
}

# ----- clone or update -----
if [ -d "$DEST/.git" ]; then
  echo "Updating existing checkout..."
  git -C "$DEST" remote set-url origin "$REPO" || true
  if ! git -C "$DEST" fetch --quiet origin "$BRANCH"; then print_auth_help; exit 1; fi
  git -C "$DEST" reset --hard "origin/$BRANCH"
else
  echo "Cloning..."
  if ! git clone --branch "$BRANCH" "$REPO" "$DEST"; then print_auth_help; exit 1; fi
fi

cd "$DEST"

# ----- run the real installer (apt deps, camera, config, systemd) -----
chmod +x install_selah.sh
./install_selah.sh

echo ""
echo "Done. Open $DEST/secrets.local.json to add your Gmail app password + weather key,"
echo "then run: cd $DEST && python3 verify_install.py"
`;

export function GET(_req: NextRequest) {
  return new Response(INSTALL_SCRIPT, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // Short cache so updates to the bootstrap propagate quickly.
      "cache-control": "public, max-age=300",
    },
  });
}
