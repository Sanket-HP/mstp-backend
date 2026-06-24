import { Router, Request, Response } from 'express';
import prisma from '../db';
import { authenticateJWT, requireRoles } from '../middleware/auth';
import { ComplaintStatus, UserRole } from '@prisma/client';

const router = Router();

// 1. FILE A COMPLAINT (Passenger/Conductor/Driver)
router.post('/', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const { category, description } = req.body;
    if (!category || !description) {
      return res.status(400).json({ error: 'Category and description are required' });
    }

    const complaint = await prisma.complaint.create({
      data: {
        userId: req.user!.id,
        category,
        description,
        status: ComplaintStatus.PENDING,
      },
    });

    res.status(201).json(complaint);
  } catch (error) {
    res.status(500).json({ error: 'Error submitting complaint' });
  }
});

// 2. GET COMPLAINTS (Role-based: Passenger sees own; Admin/Depot Manager sees all)
router.get('/', authenticateJWT, async (req: Request, res: Response) => {
  try {
    if (req.user!.role === UserRole.ADMIN || req.user!.role === UserRole.DEPOT_MANAGER) {
      const complaints = await prisma.complaint.findMany({
        include: {
          user: { select: { name: true, role: true, username: true } },
          resolvedByUser: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      return res.json(complaints);
    } else {
      const complaints = await prisma.complaint.findMany({
        where: { userId: req.user!.id },
        orderBy: { createdAt: 'desc' },
      });
      return res.json(complaints);
    }
  } catch (error) {
    res.status(500).json({ error: 'Error fetching complaints' });
  }
});

// 3. RESOLVE A COMPLAINT (Admin / Depot Manager)
router.patch('/:id/resolve', authenticateJWT, requireRoles([UserRole.ADMIN, UserRole.DEPOT_MANAGER]), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { response } = req.body;

    if (!response) {
      return res.status(400).json({ error: 'Resolution response is required' });
    }

    const updated = await prisma.complaint.update({
      where: { id },
      data: {
        status: ComplaintStatus.RESOLVED,
        response,
        resolvedByUserId: req.user!.id,
      },
      include: {
        user: true,
      },
    });

    // Create notification for the complaining user
    await prisma.notification.create({
      data: {
        userId: updated.userId,
        title: 'Complaint Resolved',
        message: `Your complaint regarding "${updated.category}" has been resolved: ${response}`,
      },
    });

    res.json({ message: 'Complaint resolved', complaint: updated });
  } catch (error) {
    res.status(500).json({ error: 'Error resolving complaint' });
  }
});

export default router;
