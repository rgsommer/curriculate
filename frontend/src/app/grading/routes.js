import OpenAI from "openai";

export const runtime = "nodejs"; // keep node runtime for OpenAI + bigger payloads

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const rubricInstructions = `
You are a teacher grading student assignments from photos.
Grade for: completeness, accuracy, clarity, and effort.
Apply these formatting deductions (each is –1):
1) missing date
2) missing a proper title (not just “check-in”)
3) missing page/question reference (if there is one)
Return JSON only with:
score_out_of_10, deductions (array of {reason, points}),
final_score_out_of_10, strengths, improvements, teacher_comment.
`.trim();

function safeJsonParse(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {}

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {}
  }
  return null;
}

export async function POST(req) {
  try {
    const body = await req.json();
    const images = Array.isArray(body?.images) ? body.images : [];

    if (images.length === 0) {
      return Response.json({ error: "No images provided." }, { status: 400 });
    }

    const content = [
      { type: "text", text: rubricInstructions },
      ...images.map((dataUrl) => ({
        type: "input_image",
        image_url: dataUrl, // expects data:image/jpeg;base64,...
      })),
    ];

    const resp = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [{ role: "user", content }],
      max_output_tokens: 900,
    });

    const text = resp.output_text || "";
    const parsed = safeJsonParse(text);

    return Response.json(
      parsed ? { json: parsed } : { raw: text },
      { status: 200 }
    );
  } catch (err) {
    console.error("POST /api/grading error:", err);
    return Response.json({ error: "Server error grading images." }, { status: 500 });
  }
}

// Helpful for quick browser check: GET /api/grading
export async function GET() {
  return Response.json(
    { ok: true, message: "Grading API is alive. Use POST with { images: [dataUrl,...] }" },
    { status: 200 }
  );
}
