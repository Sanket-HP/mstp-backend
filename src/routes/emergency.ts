import { Router, Request, Response } from 'express';
import prisma from '../db';
import { authenticateJWT, requireRoles } from '../middleware/auth';
import { EmergencyStatus, UserRole } from '@prisma/client';

const router = Router();

// 1. REPORT EMERGENCY (Driver / Conductor only)
router.post('/', authenticateJWT, requireRoles([UserRole.DRIVER, UserRole.CONDUCTOR]), async (req: Request, res: Response) => {
  try {
    const { tripId, type, description, latitude, longitude } = req.body;

    if (!type || !description || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: 'Missing required emergency fields: type, description, latitude, longitude' });
    }

    const report = await prisma.emergencyReport.create({
      data: {
        tripId: tripId || null,
        reporterId: req.user!.id,
        type,
        description,
        latitude,
        longitude,
        status: EmergencyStatus.OPEN,
      },
      include: {
        reporter: { select: { name: true, employeeId: true } },
        trip: { include: { route: true, bus: true } },
      },
    });

    // If it's a breakdown, automatically update bus status in DB
    if (type === 'BREAKDOWN' && tripId) {
      const trip = await prisma.trip.findUnique({ where: { id: tripId } });
      if (trip) {
        await prisma.bus.update({
          where: { id: trip.busId },
          data: { status: 'BROKEN_DOWN' },
        });
      }
    }

    // Create Audit Log
    await prisma.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'EMERGENCY_REPORT',
        details: `SOS Emergency of type ${type} reported. Details: ${description}`,
      },
    });

    res.status(201).json(report);
  } catch (error) {
    console.error('SOS report error:', error);
    res.status(500).json({ error: 'Error submitting emergency report' });
  }
});

// 2. GET ACTIVE EMERGENCIES (Depot Manager / Admin)
router.get('/', authenticateJWT, requireRoles([UserRole.DEPOT_MANAGER, UserRole.ADMIN]), async (req: Request, res: Response) => {
  try {
    const reports = await prisma.emergencyReport.findMany({
      include: {
        reporter: { select: { name: true, employeeId: true } },
        trip: {
          include: {
            route: true,
            bus: true,
            driver: { include: { user: true } },
            conductor: { include: { user: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(reports);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching emergencies' });
  }
});

// 3. RESOLVE EMERGENCY (Depot Manager / Admin)
router.patch('/:id/resolve', authenticateJWT, requireRoles([UserRole.DEPOT_MANAGER, UserRole.ADMIN]), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const updated = await prisma.emergencyReport.update({
      where: { id },
      data: {
        status: EmergencyStatus.RESOLVED,
        resolvedAt: new Date(),
      },
      include: {
        trip: true,
      },
    });

    // If it was a breakdown, reset bus back to ACTIVE upon resolving
    if (updated.type === 'BREAKDOWN' && updated.trip) {
      await prisma.bus.update({
        where: { id: updated.trip.busId },
        data: { status: 'ACTIVE' },
      });
    }

    await prisma.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'EMERGENCY_RESOLVE',
        details: `SOS Emergency report ID ${id} resolved.`,
      },
    });

    res.json({ message: 'Emergency marked as resolved', report: updated });
  } catch (error) {
    res.status(500).json({ error: 'Error resolving emergency' });
  }
});

export default router;
