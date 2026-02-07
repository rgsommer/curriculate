export async function goToPricingWithHandoff({ apiBase, token, returnTo }) {
  const res = await fetch(`${apiBase}/api/billing/handoff`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Handoff failed (${res.status})`);

  const code = data?.handoffCode;
  if (!code) throw new Error("Backend did not return handoffCode");

  const rt = returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : "";
  window.location.href = `https://www.curriculate.net/pricing?handoff=${encodeURIComponent(code)}${rt}`;
}
