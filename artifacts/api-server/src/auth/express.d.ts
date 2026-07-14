import type { PrincipalContext } from "./types.js";

declare global {
  namespace Express {
    interface Request {
      auth?: PrincipalContext;
      operationId?: string;
      stepUpCredentialId?: string;
    }
  }
}

export {};
