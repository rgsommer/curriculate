// backend/behavior/lib/foodDriveVision.js
//
// Reads Food Drive class sheets with AI vision: a TYPED list of student names,
// each with a HANDWRITTEN number of items beside it. Returns [{name, items}].
// Accepts image uploads directly and converts PDF uploads to page images via
// poppler's pdftoppm. Same OpenAI Responses + vision approach the grading system
// uses (OPENAI_API_KEY, AI_MODEL).

import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import os from "os";
import path from "path";

const execFileP = promisify(execFile);

async function filesToImageDataUrls(files) {
  const urls = [];
  for (const f of files || []) {
    const ct = f.mimetype || "";
    const isPdf = ct === "application/pdf" || /\.pdf$/i.test(f.originalname || "");
    if (isPdf) {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fd-"));
      try {
        const pdfPath = path.join(dir, "in.pdf");
        await fs.writeFile(pdfPath, f.buffer);
        // Render pages to PNG at 150 dpi (plenty for handwriting), cap at 25 pages.
        await execFileP("pdftoppm", ["-png", "-r", "150", "-l", "25", pdfPath, path.join(dir, "page")]);
        const names = (await fs.readdir(dir)).filter((n) => n.endsWith(".png")).sort();
        for (const n of names) {
          const buf = await fs.readFile(path.join(dir, n));
          urls.push(`data:image/png;base64,${buf.toString("base64")}`);
        }
      } finally {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    } else if (/^image\//.test(ct)) {
      urls.push(`data:${ct};base64,${f.buffer.toString("base64")}`);
    }
  }
  return urls;
}

/**
 * @returns {Promise<{ rows: Array<{name:string, items:number|null}>, images:number }>}
 */
export async function readFoodDriveSheets(files) {
  const images = await filesToImageDataUrls(files);
  if (!images.length) return { rows: [], images: 0 };
  if (!process.env.OPENAI_API_KEY) throw new Error("Vision isn't configured (OPENAI_API_KEY missing).");
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY.trim() });
  const model = process.env.AI_MODEL || process.env.BEHAVIOR_AI_MODEL || "gpt-4o";

  const schema = {
    type: "object", additionalProperties: false,
    properties: {
      rows: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          properties: { name: { type: "string" }, items: { type: ["integer", "null"] } },
          required: ["name", "items"],
        },
      },
    },
    required: ["rows"],
  };
  const instr =
    "Each image is a Food Drive class sheet: a TYPED list of student names, each with a HANDWRITTEN number of food-drive items written beside the name. " +
    "For EVERY name on EVERY sheet, return the student's name exactly as typed and the handwritten count as an integer. " +
    "If a row has no number, or the number is blank/illegible, return items: null (do not guess). " +
    "Do not invent names, do not skip names, and do not include header or total rows.";

  const content = [{ type: "input_text", text: instr }, ...images.map((u) => ({ type: "input_image", image_url: u }))];
  const resp = await client.responses.create({
    model,
    input: [{ role: "user", content }],
    text: { format: { type: "json_schema", name: "food_drive", strict: true, schema } },
    max_output_tokens: 6000,
  });
  let parsed = {};
  try { parsed = JSON.parse(resp.output_text || "{}"); } catch { parsed = { rows: [] }; }
  return { rows: Array.isArray(parsed.rows) ? parsed.rows : [], images: images.length };
}
