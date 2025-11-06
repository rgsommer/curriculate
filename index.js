import express from "express";
const app = express();
app.get("/", (req, res) => res.send("Curriculate is alive!"));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));
