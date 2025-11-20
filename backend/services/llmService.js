// services/llmService.js
// NOTE: Replace this stub with your real OpenAI (or other) integration.
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function callLLM(prompt) {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not set');
  }

  // PSEUDO-CODE: adapt to your real client
  // Using fetch as a simple example; replace with official SDK if you’re using it.
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: 'You are an AI that outputs ONLY valid JSON.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.4
    })
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('LLM error', text);
    throw new Error('LLM API error');
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  return content.trim();
}

module.exports = { callLLM };
