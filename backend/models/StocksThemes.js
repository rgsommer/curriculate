// backend/models/StocksThemes.js
//
// User-editable list of structural themes the SPEC-discovery pipeline
// is allowed to hunt inside. Per user Aug 5 overhaul spec §3 (theme-
// first discovery): a chart-pattern setup can no longer generate a
// SPEC recommendation on its own. To surface as a SPEC candidate, the
// ticker MUST be a member of an enabled theme.
//
// One document per user. Themes are a small (< 20) curated list of
// multi-quarter structural bets — AI infrastructure buildout, energy
// transition, Canadian energy pipelines, etc. Ticker membership is
// the primary filter; keywords are used by the sector-rotation +
// discovery scan for softer matches when a name isn't yet on the list.
//
// Defaults are seeded on first access (getOrSeedThemesForUser) so new
// users don't have to configure anything to benefit from the gate.

import mongoose from "mongoose";

const StocksThemeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    // Case-insensitive uppercase base tickers (no exchange suffix).
    // The membership check strips .TO / .V / .NE before comparing.
    tickers: { type: [String], default: [] },
    // Optional keywords for softer membership (sector match, news
    // heuristic). Not required for a strict membership check.
    keywords: { type: [String], default: [] },
    enabled: { type: Boolean, default: true },
  },
  { _id: false }
);

const StocksThemesSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, index: true },
    themes: { type: [StocksThemeSchema], default: [] },
  },
  { timestamps: true }
);

export default mongoose.models.StocksThemes || mongoose.model("StocksThemes", StocksThemesSchema);
