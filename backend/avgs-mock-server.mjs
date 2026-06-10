// Throwaway mock for local /avgs UI testing — returns canned extraction results.
import express from "express";
const app = express();
app.use(express.json({ limit: "25mb" }));
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.post("/avgs/extract", (req, res) => {
  const { text } = req.body || {};
  console.log("got chunk, text len:", (text || "").length, "images:", (req.body.images || []).length);
  res.json({ students: [
    { name: "Jordan Lee", gradeLevel: "6", courses: [
      { course: "Math", finalGradeRaw: "88%", finalGradePercent: 88, daysPerWeek: 4, weight: 0.8 },
      { course: "English Language Arts", finalGradeRaw: "91%", finalGradePercent: 91, daysPerWeek: 4, weight: 0.8 },
      { course: "Art", finalGradeRaw: "95%", finalGradePercent: 95, daysPerWeek: 2, weight: 0.4 },
      { course: "PE", finalGradeRaw: "A", finalGradePercent: 93, daysPerWeek: 1, weight: 0.2 },
      { course: "CE", finalGradeRaw: "Proficient", finalGradePercent: 85, daysPerWeek: 5, weight: 0.5 },
    ]},
    { name: "Priya Sharma", gradeLevel: "6", courses: [
      { course: "Math", finalGradeRaw: "72%", finalGradePercent: 72, daysPerWeek: 4, weight: 0.8 },
      { course: "English", finalGradeRaw: "81%", finalGradePercent: 81, daysPerWeek: 4, weight: 0.8 },
      { course: "Art", finalGradeRaw: "B+", finalGradePercent: 87, daysPerWeek: 2, weight: 0.4 },
      { course: "PE", finalGradeRaw: "92%", finalGradePercent: 92, daysPerWeek: 1, weight: 0.2 },
      { course: "CE", finalGradeRaw: "Extending", finalGradePercent: 95, daysPerWeek: 5, weight: 0.5 },
    ]},
    { name: "Marcus Chen", gradeLevel: "7", courses: [
      { course: "Math", finalGradeRaw: "95%", finalGradePercent: 95, daysPerWeek: 4, weight: 0.8 },
      { course: "Band", finalGradeRaw: "97%", finalGradePercent: 97, daysPerWeek: 2, weight: 0.4 },
      { course: "CE", finalGradeRaw: "Incomplete", finalGradePercent: null, daysPerWeek: 5, weight: 0.5 },
    ]},
  ]});
});
app.listen(45301, () => console.log("mock up on 45301"));
