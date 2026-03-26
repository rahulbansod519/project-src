import type { Request, Response, NextFunction } from "express";

declare global {
  namespace Express {
    interface Request {
      didApiKey?: string;
      elevenlabsApiKey?: string;
    }
  }
}

export function extractApiKeys(req: Request, _res: Response, next: NextFunction): void {
  req.didApiKey = (req.headers["x-did-api-key"] as string) || process.env.DID_API_KEY || undefined;
  req.elevenlabsApiKey = (req.headers["x-elevenlabs-api-key"] as string) || process.env.ELEVENLABS_API_KEY || undefined;
  next();
}
