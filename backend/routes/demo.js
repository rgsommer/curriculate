// backend/routes/demo.js
// Conference demo endpoints: lead registration + results capture + email
import express from "express";
import rateLimit from "express-rate-limit";
import ConferenceLead from "../models/ConferenceLead.js";
import { sendSystemEmail } from "../email/shareInviteEmailer.js";

const router = express.Router();

/* ------------------------------------------------------------------ */
/*  Rate limiters                                                      */
/* ------------------------------------------------------------------ */

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,
  message: { error: "Too many registrations, please try again later" },
});

const resultsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: "Too many submissions, please try again later" },
});

/* ------------------------------------------------------------------ */
/*  POST /demo/register                                                */
/*  Captures name, email, role for a conference visitor                 */
/* ------------------------------------------------------------------ */

router.post("/register", registerLimiter, async (req, res) => {
  try {
    const { name, email, role, conference } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: "Name and email are required" });
    }

    // Upsert: if same email + conference already exists, update name/role
    const lead = await ConferenceLead.findOneAndUpdate(
      { email: email.toLowerCase().trim(), conference: conference || "general" },
      {
        $set: {
          name: name.trim(),
          email: email.toLowerCase().trim(),
          role: role || "",
          conference: conference || "general",
        },
        $setOnInsert: { registeredAt: new Date() },
      },
      { upsert: true, new: true }
    );

    res.json({ ok: true, leadId: lead._id });
  } catch (err) {
    console.error("[demo/register] Error:", err.message);
    res.status(500).json({ error: "Registration failed" });
  }
});

/* ------------------------------------------------------------------ */
/*  POST /demo/results                                                 */
/*  Stores task results for a lead and sends the results email         */
/* ------------------------------------------------------------------ */

router.post("/results", resultsLimiter, async (req, res) => {
  try {
    const { email, results, conference } = req.body;

    if (!email || !results) {
      return res.status(400).json({ error: "Email and results are required" });
    }

    const lead = await ConferenceLead.findOneAndUpdate(
      { email: email.toLowerCase().trim(), conference: conference || "general" },
      {
        $set: { results, resultsSentAt: new Date() },
      },
      { new: true }
    );

    if (!lead) {
      return res.status(404).json({ error: "Lead not found — register first" });
    }

    // Send results email (fire-and-forget)
    sendDemoResultsEmail(lead).catch((err) =>
      console.error("[demo/results] Email send failed:", err.message)
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("[demo/results] Error:", err.message);
    res.status(500).json({ error: "Failed to save results" });
  }
});

/* ------------------------------------------------------------------ */
/*  GET /demo/leads                                                    */
/*  Admin: list all conference leads (simple auth via query param)      */
/* ------------------------------------------------------------------ */

router.get("/leads", async (req, res) => {
  try {
    const key = req.query.key;
    if (key !== process.env.ADMIN_API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const leads = await ConferenceLead.find()
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    res.json({ ok: true, count: leads.length, leads });
  } catch (err) {
    console.error("[demo/leads] Error:", err.message);
    res.status(500).json({ error: "Failed to fetch leads" });
  }
});

/* ------------------------------------------------------------------ */
/*  RESULTS EMAIL                                                      */
/* ------------------------------------------------------------------ */

async function sendDemoResultsEmail(lead) {
  const completed = lead.results.filter((r) => !r.skipped);
  const skipped = lead.results.filter((r) => r.skipped);
  const firstName = (lead.name || "").split(" ")[0] || "there";

  // Build task result rows
  const taskRows = lead.results
    .map((r) => {
      const icon = r.skipped ? "⏭️" : "✅";
      const status = r.skipped ? "Skipped" : "Completed";
      const statusColor = r.skipped ? "#94a3b8" : "#16a34a";
      return `
        <tr>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; font-size: 14px; color: #334155;">
            ${icon} ${esc(r.title || r.taskType)}
          </td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; font-size: 13px; color: #64748b;">
            ${esc(r.taskType)}
          </td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; font-size: 13px; font-weight: 600; color: ${statusColor};">
            ${status}
          </td>
        </tr>`;
    })
    .join("");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 0; background: #ffffff;">
      <!-- Header -->
      <div style="background: linear-gradient(135deg, #2563eb, #7c3aed); border-radius: 16px 16px 0 0; padding: 32px 24px; text-align: center;">
        <div style="font-size: 28px; font-weight: 900; color: #ffffff; letter-spacing: -0.5px;">Curriculate</div>
        <div style="font-size: 14px; color: rgba(255,255,255,0.8); margin-top: 6px;">Your Demo Results</div>
      </div>

      <!-- Body -->
      <div style="padding: 28px 24px; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">
        <p style="margin: 0 0 20px; font-size: 16px; color: #1e293b; line-height: 1.6;">
          Hey ${esc(firstName)}! 👋 Thanks for trying Curriculate at the conference.
          Here's a summary of your demo session:
        </p>

        <!-- Stats card -->
        <div style="display: flex; gap: 12px; margin-bottom: 24px;">
          <div style="flex: 1; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 16px; text-align: center;">
            <div style="font-size: 28px; font-weight: 900; color: #16a34a;">${completed.length}</div>
            <div style="font-size: 12px; color: #15803d; font-weight: 600;">Completed</div>
          </div>
          <div style="flex: 1; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; text-align: center;">
            <div style="font-size: 28px; font-weight: 900; color: #64748b;">${skipped.length}</div>
            <div style="font-size: 12px; color: #94a3b8; font-weight: 600;">Skipped</div>
          </div>
          <div style="flex: 1; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 12px; padding: 16px; text-align: center;">
            <div style="font-size: 28px; font-weight: 900; color: #2563eb;">${lead.results.length}</div>
            <div style="font-size: 12px; color: #3b82f6; font-weight: 600;">Total Tasks</div>
          </div>
        </div>

        <!-- Results table -->
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
          <thead>
            <tr style="background: #f8fafc;">
              <th style="padding: 10px 12px; text-align: left; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; border-bottom: 2px solid #e2e8f0;">Task</th>
              <th style="padding: 10px 12px; text-align: left; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; border-bottom: 2px solid #e2e8f0;">Type</th>
              <th style="padding: 10px 12px; text-align: left; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; border-bottom: 2px solid #e2e8f0;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${taskRows}
          </tbody>
        </table>

        <!-- Promo section -->
        <div style="background: linear-gradient(135deg, #fef3c7, #fde68a); border: 2px solid #f59e0b; border-radius: 16px; padding: 24px; text-align: center; margin-bottom: 24px;">
          <div style="font-size: 14px; color: #92400e; font-weight: 600; margin-bottom: 8px;">🎉 Exclusive Conference Offer</div>
          <div style="font-size: 22px; font-weight: 900; color: #78350f; margin-bottom: 4px;">1 Month Free</div>
          <div style="font-size: 13px; color: #92400e; margin-bottom: 16px;">Use promo code at signup:</div>
          <div style="display: inline-block; background: #ffffff; border: 2px dashed #f59e0b; border-radius: 10px; padding: 10px 24px; font-size: 22px; font-weight: 900; color: #78350f; letter-spacing: 2px;">
            ${esc(lead.promoCode || "CONFERENCE2025")}
          </div>
        </div>

        <!-- CTA button -->
        <div style="text-align: center; margin-bottom: 8px;">
          <a href="https://www.curriculate.net/pricing?promo=${encodeURIComponent(lead.promoCode || "CONFERENCE2025")}&ref=demo" style="display: inline-block; padding: 14px 36px; background: linear-gradient(135deg, #2563eb, #7c3aed); color: #ffffff; text-decoration: none; border-radius: 12px; font-weight: 800; font-size: 16px;">
            Start Your Free Month →
          </a>
        </div>
      </div>

      <!-- Footer -->
      <div style="background: #f8fafc; border-radius: 0 0 16px 16px; padding: 20px 24px; border: 1px solid #e2e8f0; border-top: none; text-align: center;">
        <p style="margin: 0; font-size: 12px; color: #94a3b8; line-height: 1.5;">
          Curriculate — AI-powered interactive learning for classrooms<br/>
          <a href="https://www.curriculate.net" style="color: #3b82f6; text-decoration: none;">curriculate.net</a>
        </p>
      </div>
    </div>
  `;

  await sendSystemEmail({
    to: lead.email,
    subject: `Your Curriculate Demo Results 🎯 + Free Month Offer`,
    html,
  });

  console.log(`[demo] ✅ Results email sent to ${lead.email}`);
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function esc(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default router;
