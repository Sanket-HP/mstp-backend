import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { UserRole } from "@prisma/client";

const JWT_SECRET =
process.env.JWT_SECRET || "mstp_super_secret_jwt_key_2026";

export function authenticateJWT(
  req: Request,
  res: Response,
  next: NextFunction
) {
const authHeader = req.headers?.authorization;

if (!authHeader?.startsWith("Bearer ")) {
return res.status(401).json({
error: "Access token missing or invalid format",
});
}

try {
const token = authHeader.split(" ")[1];
const payload = jwt.verify(token, JWT_SECRET) as any;


req.user = payload;
next();


} catch (err) {
return res.status(403).json({
error: "Token is invalid or expired",
});
}
}

export function requireRoles(allowedRoles: UserRole[]) {
return (
req: Request,
res: Response,
next: NextFunction
) => {
if (!req.user) {
return res.status(401).json({
error: "User is not authenticated",
});
}


if (!allowedRoles.includes(req.user.role)) {
  return res.status(403).json({
    error: "You do not have permission to access this resource",
  });
}

next();


};
}
