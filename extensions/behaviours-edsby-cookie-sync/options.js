const $ = (id) => document.getElementById(id);

async function load() {
  const { edsbyHost, ingestToken, ingestUrl, lastPush } = await chrome.storage.local.get([
    "edsbyHost",
    "ingestToken",
    "ingestUrl",
    "lastPush",
  ]);
  $("edsbyHost").value = edsbyHost || "";
  $("token").value = ingestToken || "";
  $("ingestUrl").value = ingestUrl || "";
  $("lastPush").textContent = lastPush ? JSON.stringify(lastPush, null, 2) : "(none yet)";

  const host = (edsbyHost || "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!host) {
    $("currentCookie").textContent = "Enter your Edsby host above to check the cookie.";
    return;
  }
  const cookie = await chrome.cookies.get({ url: "https://" + host + "/", name: "session_id_edsby" });
  $("currentCookie").textContent = cookie
    ? "session_id_edsby found (domain " + cookie.domain + ", expires " +
      (cookie.expirationDate ? new Date(cookie.expirationDate * 1000).toLocaleString() : "session") + ")"
    : "No session cookie found. Open https://" + host + "/ and sign in.";
}

$("save").addEventListener("click", async () => {
  await chrome.storage.local.set({
    edsbyHost: $("edsbyHost").value.trim(),
    ingestToken: $("token").value.trim(),
    ingestUrl: $("ingestUrl").value.trim(),
  });
  $("save").textContent = "Saved";
  setTimeout(() => ($("save").textContent = "Save"), 1500);
  load();
});

$("testNow").addEventListener("click", async () => {
  $("testNow").textContent = "Pushing…";
  // Save first so the push uses the latest values.
  await chrome.storage.local.set({
    edsbyHost: $("edsbyHost").value.trim(),
    ingestToken: $("token").value.trim(),
    ingestUrl: $("ingestUrl").value.trim(),
  });
  const r = await chrome.runtime.sendMessage({ type: "pushNow" });
  $("testNow").textContent = "Push current cookie now";
  await load();
  $("lastPush").textContent = JSON.stringify(r || { ok: false, error: "no response" }, null, 2);
});

load();
