import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { storage } from "./storage";
import type { User } from "@shared/schema";

const JWT_SECRET = process.env.JWT_SECRET || "sitemapper-dev-secret-change-in-prod";

// Owner-tier emails are auto-promoted on every user load. Configure via
// OWNER_EMAILS env (comma-separated). Owner tier grants 10,000 pages,
// unlimited crawls, and access to URL-list uploads.
const OWNER_EMAILS = (process.env.OWNER_EMAILS || "rodrigo.stockebrand@gmail.com")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

/**
 * Returns the user with tier="owner" applied in-memory if the email is on
 * the owner whitelist. Does not persist to DB — tier reflects live env
 * config so removing an email from OWNER_EMAILS immediately revokes access.
 */
export function applyOwnerTier<T extends { email: string; tier: any } | undefined | null>(user: T): T {
  if (!user) return user;
  if (OWNER_EMAILS.includes(user.email.toLowerCase())) {
    return { ...(user as any), tier: "owner" } as T;
  }
  return user;
}

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
        (req as any).user = applyOwnerTier(user);
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

  (req as any).user = applyOwnerTier(user);
  next();
}

/** Extract user from request (use after optionalAuth or requireAuth) */
export function getRequestUser(req: Request): User | undefined {
  return (req as any).user;
}
