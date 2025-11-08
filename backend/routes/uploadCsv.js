// backend/routes/uploadCsv.js
import express from "express";
import csv from "csv-parser";
import { Readable } from "stream";
import TaskSet from "../models/TaskSet.js";
import jwt from "jsonwebtoken";

const router = express.Router();

function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ error: "No token" });
  const token = h.split(" ")[1];
  const payload = jwt.verify(token, process.env.JWT_SECRET || "devsecret");
  req.userId = payload.id;
  next();
}

// expect CSV text in body.csv
router.post("/", auth, async (req, res) => {
  const { csvText, title, description } = req.body;

  const rows = [];
  const stream = Readable.from([csvText]);
  stream
    .pipe(csv())
    .on("data", (row) => rows.push(row))
    .on("end", async () => {
      const tasks = rows.map((r) => {
        return {
          stationId: Number(r.station_id),
          type: r.type,
          prompt: r.prompt,
          subject: r.subject || null,
          data: {
            option1: r.option1,
            option2: r.option2,
            option3: r.option3,
            option4: r.option4,
            answer: r.answer,
            imageUrl: r.image_url,
            audioUrl: r.audio_url,
            recordMode: r.record_mode,
            evaluationMode: r.evaluation_mode,
          },
          scoring: {
            mode: r.scoring_mode || "timedRace",
            points: Number(r.points) || 10,
          },
        };
      });

      const taskSet = await TaskSet.create({
        owner: req.userId,
        title: title || "Imported Task Set",
        description: description || "",
        tasks,
      });

      res.json(taskSet);
    });
});

export default router;
