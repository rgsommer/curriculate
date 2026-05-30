// Multi-bank-account UI for the employee form.
(function () {
  const table = document.getElementById('bank-accounts-table');
  if (!table) return;
  const tbody = table.querySelector('tbody');
  const totalEl = document.getElementById('ba-total');

  function recalc() {
    let sum = 0;
    table.querySelectorAll('.ba-pct').forEach(el => { sum += parseFloat(el.value) || 0; });
    totalEl.textContent = sum.toFixed(2);
    totalEl.style.color = Math.abs(sum - 100) < 0.011 ? 'var(--ok)' : 'var(--brand)';
  }

  function rowFromTemplate() {
    const first = tbody.querySelector('tr');
    if (!first) return null;
    const clone = first.cloneNode(true);
    clone.querySelectorAll('input').forEach(i => { i.value = ''; });
    const sel = clone.querySelector('select'); if (sel) sel.selectedIndex = 0;
    return clone;
  }

  document.getElementById('ba-add').addEventListener('click', () => {
    const row = rowFromTemplate();
    if (row) tbody.appendChild(row);
    recalc();
  });

  table.addEventListener('click', (ev) => {
    if (ev.target.classList.contains('ba-remove')) {
      const rows = tbody.querySelectorAll('tr');
      if (rows.length <= 1) return; // keep at least one row
      ev.target.closest('tr').remove();
      recalc();
    }
  });

  table.addEventListener('input', (ev) => {
    if (ev.target.classList.contains('ba-pct')) recalc();
  });
  recalc();
})();
