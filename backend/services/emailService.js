// services/emailService.js
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  // configure with your SMTP/SendGrid/etc.
});

function buildSessionSummaryHTML({ session, sessionAnalytics }) {
  return `
  <html>
    <body style="font-family: Arial, sans-serif;">
      <h2>Curriculate Session Report</h2>
      <p>
        <strong>Teacher:</strong> ${session.teacherName || ""}<br/>
        <strong>Class:</strong> ${session.classroomName || ""}<br/>
        <strong>Task Set:</strong> ${session.taskSetName || ""}<br/>
        <strong>Date:</strong> ${new Date(session.startedAt).toLocaleString()}
      </p>
      <h3>Class Summary</h3>
      <ul>
        <li>Class Average Score: ${sessionAnalytics.classAverageScore}%</li>
        <li>Class Average Accuracy: ${sessionAnalytics.classAverageAccuracy}%</li>
      </ul>

      <h3>Top Tasks</h3>
      <ol>
        ${sessionAnalytics.tasks
          .slice(0, 5)
          .map(
            (t) =>
              `<li><strong>[${t.type}]</strong> ${t.prompt.slice(
                0,
                80
              )}... – Avg Accuracy: ${t.avgCorrectPct}%</li>`
          )
          .join("")}
      </ol>

      <p>You can find the full student-by-student transcript in the attached PDF.</p>
    </body>
  </html>
  `;
}

async function sendSessionReportEmail({ teacher, session, sessionAnalytics, pdfBuffer }) {
  const htmlBody = buildSessionSummaryHTML({ session, sessionAnalytics });

  await transporter.sendMail({
    from: '"Curriculate" <no-reply@curriculate.com>',
    to: teacher.email,
    subject: `Curriculate Report – ${session.classroomName || "Class"} – ${new Date(
      session.startedAt
    ).toLocaleDateString()}`,
    html: htmlBody,
    attachments: [
      {
        filename: "Curriculate-Session-Report.pdf",
        content: pdfBuffer,
      },
    ],
  });
}

module.exports = { sendSessionReportEmail };
