import admin from "firebase-admin";
import { Request, Response, NextFunction } from "express";
import * as dotenv from "dotenv";

dotenv.config();

// Load Firebase credentials (replace with actual path)
const serviceAccount = require("./cert.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Custom TypeScript interface for the request object
interface AuthenticatedRequest extends Request {
  user?: admin.auth.DecodedIdToken;
}

export function authenticateToken(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  next();
  return;
  //   const authHeader = req.headers.authorization;
  //   if (!authHeader || !authHeader.startsWith("Bearer ")) {
  //     res.status(401).json({ message: "No token provided" });
  //     return; // ✅ Ensure we return here
  //   }

  //   const token = authHeader.split("Bearer ")[1];

  //   admin
  //     .auth()
  //     .verifyIdToken(token)
  //     .then((decodedToken) => {
  //       req.user = decodedToken;
  //       next(); // ✅ Move to next middleware only on success
  //     })
  //     .catch(() => {
  //       res.status(403).json({ message: "Invalid or expired token" });
  //       return; // ✅ Ensure function exits after response
  //     });
}
