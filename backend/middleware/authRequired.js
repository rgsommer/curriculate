// backend/middleware/authRequired.js
// Back-compat shim: unify on authAny, but keep old import path working.

import { authAny } from "./authAny.js";

export const authRequired = authAny;
export default authAny;
