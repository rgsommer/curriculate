// shared/config/copy.js
//
// Host-aware brand copy. See shared/brandContext.js for the source of truth.
// Preserved as a COPY.* accessor for callers that already import it (station
// posters, session posters). Getters keep evaluation lazy — the host may not
// be known at module-load time.
import { brandName, brandDomain } from "../brandContext.js";

export const COPY = {
  get APP_NAME() { return brandName(); },      // "Curriculate" | "Qrewzi"
  TAGLINE: "Adventure-Powered Learning",
  get DOMAIN() { return brandDomain(); },      // "curriculate.net" | "qrewzi.com"
};
