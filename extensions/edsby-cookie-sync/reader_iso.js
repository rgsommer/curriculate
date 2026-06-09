// Runs in the isolated content-script world. Relays the page identifiers that
// reader_main.js posted to the service worker, which combines them with the
// cookie and pushes everything to the Behaviours app.
window.addEventListener("message", (ev) => {
  if (ev.source !== window) return;
  if (!ev.data || !ev.data.__edsbySync) return;
  try {
    chrome.runtime.sendMessage({ type: "pageCreds", data: ev.data.data });
  } catch (e) {
    /* service worker may be asleep; the next page load will retry */
  }
});
