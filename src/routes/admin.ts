import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../db';
import { authenticateJWT, requireRoles } from '../middleware/auth';
import { UserRole } from '@prisma/client';

const router = Router();

// Apply check to ensure only Administrators can access
router.use(authenticateJWT, requireRoles([UserRole.ADMIN]));

// ==========================================
// 1. USER CRUD
// ==========================================
router.get('/users', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      include: {
        passengerProfile: true,
        driverProfile: true,
        conductorProfile: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching users' });
  }
});

router.post('/users', async (req, res) => {
  try {
    const { username, password, name, role, email, mobile, employeeId, licenseNumber } = req.body;

    if (!username || !password || !name || !role) {
      return res.status(400).json({ error: 'Username, password, name, and role are required' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const data: any = {
      username,
      password: hashedPassword,
      name,
      role,
      email,
      mobile,
      employeeId,
    };

    // Conditional profile creation based on role
    if (role === UserRole.DRIVER) {
      if (!employeeId || !licenseNumber) {
        return res.status(400).json({ error: 'Employee ID and license number are required for Driver' });
      }
      data.driverProfile = {
        create: { employeeId, licenseNumber },
      };
    } else if (role === UserRole.CONDUCTOR) {
      if (!employeeId) {
        return res.status(400).json({ error: 'Employee ID is required for Conductor' });
      }
      data.conductorProfile = {
        create: { employeeId },
      };
    } else if (role === UserRole.PASSENGER) {
      data.passengerProfile = {
        create: { name, mobile: mobile || `PAS-${Date.now()}`, email },
      };
    }

    const newUser = await prisma.user.create({
      data,
    });

    res.status(201).json(newUser);
  } catch (error: any) {
    console.error('Error creating user:', error);
    res.status(400).json({ error: error.message || 'Error creating user' });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.user.delete({ where: { id } });
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting user' });
  }
});

// ==========================================
// 2. BUS CRUD
// ==========================================
router.get('/buses', async (req, res) => {
  try {
    const buses = await prisma.bus.findMany({
      include: { depot: true },
      orderBy: { registrationNumber: 'asc' },
    });
    res.json(buses);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching buses' });
  }
});

router.post('/buses', async (req, res) => {
  try {
    const { registrationNumber, model, capacity, status, depotId } = req.body;
    if (!registrationNumber || !model || !depotId) {
      return res.status(400).json({ error: 'Registration number, model, and depotId are required' });
    }

    const bus = await prisma.bus.create({
      data: {
        registrationNumber,
        model,
        capacity: Number(capacity) || 40,
        status,
        depotId,
      },
    });
    res.status(201).json(bus);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Error creating bus' });
  }
});

router.delete('/buses/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.bus.delete({ where: { id } });
    res.json({ message: 'Bus deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting bus' });
  }
});

// ==========================================
// 3. DEPOT CRUD
// ==========================================
router.get('/depots', async (req, res) => {
  try {
    const depots = await prisma.depot.findMany({
      orderBy: { name: 'asc' },
    });
    res.json(depots);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching depots' });
  }
});

router.post('/depots', async (req, res) => {
  try {
    const { name, locationName, latitude, longitude, contactNumber } = req.body;
    if (!name || !locationName || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: 'Name, locationName, latitude, and longitude are required' });
    }
    const depot = await prisma.depot.create({
      data: {
        name,
        locationName,
        latitude: Number(latitude),
        longitude: Number(longitude),
        contactNumber,
      },
    });
    res.status(201).json(depot);
  } catch (error) {
    res.status(400).json({ error: 'Error creating depot' });
  }
});

// ==========================================
// 4. ROUTE & STOP CRUD
// ==========================================
router.get('/routes', async (req, res) => {
  try {
    const routes = await prisma.route.findMany({
      include: { stops: { orderBy: { sequence: 'asc' } } },
      orderBy: { routeNumber: 'asc' },
    });
    res.json(routes);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching routes' });
  }
});

router.post('/routes', async (req, res) => {
  try {
    const { routeNumber, source, destination, distanceKm, durationMinutes, stops } = req.body;
    if (!routeNumber || !source || !destination || !distanceKm || !durationMinutes) {
      return res.status(400).json({ error: 'Missing required route fields' });
    }

    const route = await prisma.route.create({
      data: {
        routeNumber,
        source,
        destination,
        distanceKm: Number(distanceKm),
        durationMinutes: Number(durationMinutes),
      },
    });

    // Create stops if provided
    if (stops && Array.isArray(stops)) {
      for (const stop of stops) {
        await prisma.stop.create({
          data: {
            routeId: route.id,
            name: stop.name,
            sequence: Number(stop.sequence),
            latitude: Number(stop.latitude),
            longitude: Number(stop.longitude),
            fareStage: !!stop.fareStage,
          },
        });
      }
    }

    res.status(201).json(route);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Error creating route' });
  }
});

// ==========================================
// 5. FARE MANAGEMENT
// ==========================================
// For demonstration, standard fare config is stored in memory or simulated by distance
router.get('/fares', async (req, res) => {
  res.json({
    baseFare: 20.0,
    ratePerKm: 2.5,
    concessions: {
      STUDENT: 0.5, // 50% off
      SENIOR_CITIZEN: 0.5,
      GENERAL: 1.0,
    },
  });
});

export default router;
