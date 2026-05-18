// Tiny shim around otplib v13 that re-creates the v12 `authenticator` API surface
// we used elsewhere in the codebase. Only the four methods we actually use:
// - generateSecret()
// - keyuri(accountName, issuer, secret)
// - check(token, secret)
// - options.window (a tolerance, in 30-second steps)
import { generateSecret, generateURI, verifySync } from "otplib";

export const authenticator = {
  options: { window: 0 as number },

  generateSecret(): string {
    return generateSecret();
  },

  keyuri(accountName: string, issuer: string, secret: string): string {
    // otplib v13's generateURI uses `label` instead of `accountName`.
    return generateURI({ issuer, label: accountName, secret });
  },

  check(token: string, secret: string): boolean {
    try {
      const r: any = verifySync({
        secret,
        token,
        // window:1 in v12 ≈ epochTolerance:1 in v13 (accept ± 1 30-sec step)
        epochTolerance: this.options.window || 0,
      } as any);
      return !!(r && r.valid);
    } catch {
      return false;
    }
  },
};
