// Mobile nav toggle + active link highlighting + smooth scroll for anchors
(function () {
  const toggle = document.querySelector(".nav-toggle");
  const list = document.querySelector(".nav-list");

  if (toggle && list) {
    toggle.addEventListener("click", () => {
      const open = list.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.textContent = open ? "✕ Close" : "☰ Menu";
    });
  }

  // Highlight current page in nav
  const path = window.location.pathname.replace(/\/$/, "");
  const file = path.split("/").pop() || "index.html";
  document.querySelectorAll(".nav-list a").forEach((a) => {
    const href = a.getAttribute("href") || "";
    const target = href.split("/").pop();
    if (target === file || (file === "index.html" && (target === "" || target === "index.html"))) {
      a.classList.add("active");
    }
  });

  // Update copyright year
  const y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();
})();
