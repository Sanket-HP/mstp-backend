import { UserRole } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        username: string;
        role: UserRole;
        name: string;
        employeeId?: string;
        passengerId?: string;
        driverId?: string;
        conductorId?: string;
      };
    }
  }
}
export {};
