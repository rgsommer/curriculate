// Runs in the PAGE's main world (so it can read Edsby's window._cf globals) and
// posts the bundle identifiers to the isolated relay script. Read-only — it just
// reports jver/cver/userNid/formkey that the logged-in page already exposes.
(function () {
  function read() {
    try {
      var cf = window._cf || {};
      var jver = cf.jver || "";
      if (!jver) {
        var m = document.documentElement.outerHTML.match(/engine(?:\.min)?\.js\?[^"'<> ]*?[?&]_i=([A-Za-z0-9._-]+)/);
        jver = (m && m[1]) || "";
      }
      var data = {
        jver: jver,
        cver: cf.cver || "",
        userNid: (cf.user && cf.user.nid) || "",
        formkey: cf.formkey || cf._formkey || "",
      };
      if (data.jver || data.cver || data.userNid || data.formkey) {
        window.postMessage({ __edsbySync: true, data: data }, "*");
      }
    } catch (e) {
      /* ignore */
    }
  }
  read();
  // Re-read once the app has finished booting (globals can populate late).
  setTimeout(read, 4000);
})();
