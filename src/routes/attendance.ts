import { Router, Response } from 'express';
import prisma from '../db';
import { AuthenticatedRequest, authenticateJWT } from '../middleware/auth';
import { UserRole, DriverStatus, ConductorStatus } from '@prisma/client';

const router = Router();

// 1. CHECK-IN (GPS-based)
router.post('/check-in', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { latitude, longitude } = req.body;
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: 'Latitude and longitude coordinates are required' });
    }

    const userId = req.user!.id;

    // Check if already checked in today without checking out
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existingAttendance = await prisma.attendance.findFirst({
      where: {
        userId,
        checkInTime: { gte: today },
        checkOutTime: null,
      },
    });

    if (existingAttendance) {
      return res.status(400).json({ error: 'You are already checked in for today.' });
    }

    // Create attendance record
    const attendance = await prisma.attendance.create({
      data: {
        userId,
        checkInLat: latitude,
        checkInLng: longitude,
        status: 'PRESENT',
      },
    });

    // Update employee status in database
    if (req.user!.role === UserRole.DRIVER && req.user!.driverId) {
      await prisma.driver.update({
        where: { id: req.user!.driverId },
        data: { status: DriverStatus.ON_DUTY },
      });
    } else if (req.user!.role === UserRole.CONDUCTOR && req.user!.conductorId) {
      await prisma.conductor.update({
        where: { id: req.user!.conductorId },
        data: { status: ConductorStatus.ON_DUTY },
      });
    }

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'ATTENDANCE_CHECK_IN',
        details: `Check-in recorded at GPS (${latitude}, ${longitude})`,
      },
    });

    res.status(201).json({ message: 'Checked in successfully', attendance });
  } catch (error) {
    console.error('Check-in error:', error);
    res.status(500).json({ error: 'Error checking in' });
  }
});

// 2. CHECK-OUT (GPS-based)
router.post('/check-out', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { latitude, longitude } = req.body;
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: 'Latitude and longitude coordinates are required' });
    }

    const userId = req.user!.id;

    // Find latest active attendance record
    const activeAttendance = await prisma.attendance.findFirst({
      where: {
        userId,
        checkOutTime: null,
      },
      orderBy: { checkInTime: 'desc' },
    });

    if (!activeAttendance) {
      return res.status(400).json({ error: 'No active check-in session found to check out from.' });
    }

    // Update record
    const attendance = await prisma.attendance.update({
      where: { id: activeAttendance.id },
      data: {
        checkOutTime: new Date(),
        checkOutLat: latitude,
        checkOutLng: longitude,
      },
    });

    // Update status to off duty
    if (req.user!.role === UserRole.DRIVER && req.user!.driverId) {
      await prisma.driver.update({
        where: { id: req.user!.driverId },
        data: { status: DriverStatus.OFF_DUTY },
      });
    } else if (req.user!.role === UserRole.CONDUCTOR && req.user!.conductorId) {
      await prisma.conductor.update({
        where: { id: req.user!.conductorId },
        data: { status: ConductorStatus.OFF_DUTY },
      });
    }

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'ATTENDANCE_CHECK_OUT',
        details: `Check-out recorded at GPS (${latitude}, ${longitude})`,
      },
    });

    res.json({ message: 'Checked out successfully', attendance });
  } catch (error) {
    console.error('Check-out error:', error);
    res.status(500).json({ error: 'Error checking out' });
  }
});

// 3. GET ATTENDANCE HISTORY
router.get('/report', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const history = await prisma.attendance.findMany({
      where: { userId },
      orderBy: { checkInTime: 'desc' },
    });
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching attendance logs' });
  }
});

export default router;
