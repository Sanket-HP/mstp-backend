import { Router, Request, Response } from 'express';
import prisma from '../db';
import { authenticateJWT, requireRoles } from '../middleware/auth';
import { TripStatus, UserRole } from '@prisma/client';

const router = Router();

// 1. SEARCH BUSES (Passenger & all roles)
router.get('/', async (req, res) => {
  try {
    const { source, destination } = req.query;

    if (!source || !destination) {
      // Return all trips if no search params provided
      const trips = await prisma.trip.findMany({
        include: {
          route: {
            include: { stops: { orderBy: { sequence: 'asc' } } }
          },
          bus: true,
          driver: { include: { user: true } },
          conductor: { include: { user: true } },
        },
      });
      return res.json(trips);
    }

    // Direct match search or match stops on a route
    const routes = await prisma.route.findMany({
      where: {
        source: { contains: source as string, mode: 'insensitive' },
        destination: { contains: destination as string, mode: 'insensitive' },
      },
      include: {
        stops: { orderBy: { sequence: 'asc' } },
      },
    });

    const routeIds = routes.map((r) => r.id);

    const trips = await prisma.trip.findMany({
      where: {
        routeId: { in: routeIds },
        status: { in: [TripStatus.SCHEDULED, TripStatus.ACTIVE] },
      },
      include: {
        route: {
          include: { stops: { orderBy: { sequence: 'asc' } } },
        },
        bus: true,
        driver: { include: { user: true } },
        conductor: { include: { user: true } },
      },
    });

    res.json(trips);
  } catch (error) {
    console.error('Search trips error:', error);
    res.status(500).json({ error: 'Error fetching trips' });
  }
});

// 2. GET ASSIGNED DUTY (Driver or Conductor)
router.get('/assigned', authenticateJWT, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });

    let trips;

    if (req.user.role === UserRole.DRIVER) {
      if (!req.user.driverId) return res.status(400).json({ error: 'No driver profile linked' });
      trips = await prisma.trip.findMany({
        where: {
          driverId: req.user.driverId,
          status: { in: [TripStatus.SCHEDULED, TripStatus.ACTIVE] },
        },
        include: {
          route: { include: { stops: { orderBy: { sequence: 'asc' } } } },
          bus: true,
        },
        orderBy: { scheduledStart: 'asc' },
      });
    } else if (req.user.role === UserRole.CONDUCTOR) {
      if (!req.user.conductorId) return res.status(400).json({ error: 'No conductor profile linked' });
      trips = await prisma.trip.findMany({
        where: {
          conductorId: req.user.conductorId,
          status: { in: [TripStatus.SCHEDULED, TripStatus.ACTIVE] },
        },
        include: {
          route: { include: { stops: { orderBy: { sequence: 'asc' } } } },
          bus: true,
        },
        orderBy: { scheduledStart: 'asc' },
      });
    } else {
      return res.status(403).json({ error: 'Only drivers or conductors can view duties' });
    }

    res.json(trips);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching assigned duties' });
  }
});

// 3. START TRIP (Driver only)
router.post('/:id/start', authenticateJWT, requireRoles([UserRole.DRIVER]), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const trip = await prisma.trip.findUnique({ where: { id } });
    if (!trip) return res.status(404).json({ error: 'Trip not found' });

    const updatedTrip = await prisma.trip.update({
      where: { id },
      data: {
        status: TripStatus.ACTIVE,
        actualStart: new Date(),
      },
    });

    // Create Audit Log
    await prisma.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'TRIP_START',
        details: `Trip ${trip.tripNumber} started by driver.`,
      },
    });

    res.json({ message: 'Trip started successfully', trip: updatedTrip });
  } catch (error) {
    res.status(500).json({ error: 'Error starting trip' });
  }
});

// 4. END TRIP (Driver only)
router.post('/:id/end', authenticateJWT, requireRoles([UserRole.DRIVER]), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const trip = await prisma.trip.findUnique({ where: { id } });
    if (!trip) return res.status(404).json({ error: 'Trip not found' });

    const updatedTrip = await prisma.trip.update({
      where: { id },
      data: {
        status: TripStatus.COMPLETED,
        actualEnd: new Date(),
      },
    });

    // Create Audit Log
    await prisma.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'TRIP_END',
        details: `Trip ${trip.tripNumber} ended by driver.`,
      },
    });

    res.json({ message: 'Trip completed successfully', trip: updatedTrip });
  } catch (error) {
    res.status(500).json({ error: 'Error completing trip' });
  }
});

export default router;
