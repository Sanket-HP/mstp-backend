import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../db';
import { UserRole, DriverStatus, ConductorStatus } from '@prisma/client';
import { authenticateJWT } from '../middleware/auth';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'mstp_super_secret_jwt_key_2026';

// 1. REGISTER (Passenger Only)
router.post('/register', async (req, res) => {
  try {
    const { username, password, name, email, mobile } = req.body;

    if (!username || !password || !name || !mobile) {
      return res.status(400).json({ error: 'Missing required fields: username, password, name, mobile' });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ username }, { mobile }, { email: email || undefined }],
      },
    });

    if (existingUser) {
      return res.status(400).json({ error: 'Username, mobile number, or email already registered' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
        name,
        role: UserRole.PASSENGER,
        email,
        mobile,
        passengerProfile: {
          create: {
            name,
            mobile,
            email,
            walletBalance: 100.0, // complimentary balance
          },
        },
      },
      include: {
        passengerProfile: true,
      },
    });

    // Generate Token
    const token = jwt.sign(
      {
        id: newUser.id,
        username: newUser.username,
        role: newUser.role,
        name: newUser.name,
        passengerId: newUser.passengerProfile?.id,
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'Registration successful',
      token,
      user: {
        id: newUser.id,
        username: newUser.username,
        name: newUser.name,
        role: newUser.role,
        passengerId: newUser.passengerProfile?.id,
      },
    });
  } catch (error: any) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error during registration' });
  }
});

// 2. LOGIN (Supports username, email, mobile, or employee ID)
router.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Identifier and password are required' });
    }

    // Search user by username, email, mobile, or employeeId
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { username: identifier },
          { email: identifier },
          { mobile: identifier },
          { employeeId: identifier },
        ],
      },
      include: {
        passengerProfile: true,
        driverProfile: true,
        conductorProfile: true,
      },
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Create Audit Log
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'LOGIN',
        details: `User ${user.username} logged in with role ${user.role}`,
      },
    });

    // Token Payload
    const payload: any = {
      id: user.id,
      username: user.username,
      role: user.role,
      name: user.name,
    };

    if (user.role === UserRole.PASSENGER) payload.passengerId = user.passengerProfile?.id;
    if (user.role === UserRole.DRIVER) payload.driverId = user.driverProfile?.id;
    if (user.role === UserRole.CONDUCTOR) payload.conductorId = user.conductorProfile?.id;
    if (user.employeeId) payload.employeeId = user.employeeId;

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        passengerId: user.passengerProfile?.id,
        driverId: user.driverProfile?.id,
        conductorId: user.conductorProfile?.id,
        employeeId: user.employeeId,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

// 3. GET PROFILE
router.get('/profile', authenticateJWT, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });

    const userProfile = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        passengerProfile: true,
        driverProfile: true,
        conductorProfile: true,
      },
    });

    if (!userProfile) return res.status(404).json({ error: 'User not found' });

    res.json(userProfile);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching profile' });
  }
});

// 4. FORGOT PASSWORD (mock verification code)
router.post('/forgot-password', async (req, res) => {
  try {
    const { identifier } = req.body;
    if (!identifier) {
      return res.status(400).json({ error: 'Identifier is required' });
    }

    const user = await prisma.user.findFirst({
      where: {
        OR: [{ username: identifier }, { email: identifier }, { mobile: identifier }],
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'No user registered with this identifier' });
    }

    // Mock response for resetting password (production would send SMS/email)
    res.json({
      message: 'Password reset link sent to registered email / SMS verification code sent to mobile number',
      debugCode: '123456', // for easy demo
    });
  } catch (error) {
    res.status(500).json({ error: 'Error processing password reset' });
  }
});

export default router;
