// Double-click handler for the hours column.
// First dbl-click on an "hours" input: set it to the default for that employee.
// Second dbl-click: set it to 0 (didn't work).
// Third dbl-click: back to default. (Cycle.)
document.addEventListener('dblclick', (ev) => {
  const el = ev.target;

  // Hours field — cycle default <-> 0.
  if (el.classList && el.classList.contains('hours')) {
    const def = parseFloat(el.dataset.default || '0');
    const cur = parseFloat(el.value || '0');
    el.value = (cur === def) ? 0 : def;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  // Employee name — visually strike-through + zero the hours, plus
  // post to /employees/:id/deactivate so future periods don't list them.
  const nameCell = el.closest && el.closest('.emp-name');
  if (nameCell) {
    const row = nameCell.closest('tr');
    if (!row || !row.dataset.employeeId) return;
    if (row.classList.contains('deactivated')) return;
    if (!confirm(`Mark this employee as no longer employed?`)) return;
    row.classList.add('deactivated');
    nameCell.style.textDecoration = 'line-through';
    const hoursInput = row.querySelector('.hours');
    if (hoursInput) hoursInput.value = 0;
    const base = document.querySelector('meta[name="base-path"]');
    const basePath = base ? base.content : '';
    fetch(`${basePath}/employees/${row.dataset.employeeId}/deactivate`, { method: 'POST', credentials: 'same-origin' })
      .catch(() => { /* non-fatal: the zero-hour row still skips them this period */ });
  }
});
