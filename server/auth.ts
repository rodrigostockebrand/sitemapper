import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { storage } from "./storage";
import type { User } from "@shared/schema";

const JWT_SECRET = process.env.JWT_SECRET || "sitemapper-dev-secret-change-in-prod";

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): { sub: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { sub: string };
  } catch {
    return null;
  }
}

/** Middleware: attaches req.user if a valid token is present. Does NOT reject. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const payload = verifyToken(header.slice(7));
    if (payload) {
      const user = storage.getUserById(payload.sub);
      if (user) {
        (req as any).user = user;
      }
    }
  }
  next();
}

/** Middleware: requires a valid token. Rejects 401 otherwise. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const payload = verifyToken(header.slice(7));
  if (!payload) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  const user = storage.getUserById(payload.sub);
  if (!user) {
    return res.status(401).json({ error: "User not found" });
  }

  (req as any).user = user;
  next();
}

/** Extract user from request (use after optionalAuth or requireAuth) */
export function getRequestUser(req: Request): User | undefined {
  return (req as any).user;
}
