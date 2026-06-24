import { Router, Response } from 'express';
import prisma from '../db';
import { AuthenticatedRequest, authenticateJWT, requireRoles } from '../middleware/auth';
import { BookingStatus, TicketStatus, UserRole, PassStatus } from '@prisma/client';

const router = Router();

// 1. BOOK A TRIP (Passenger only)
router.post('/', authenticateJWT, requireRoles([UserRole.PASSENGER]), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { tripId, seatNumbers, totalAmount } = req.body;
    const passengerId = req.user?.passengerId;

    if (!passengerId) return res.status(400).json({ error: 'No passenger profile linked' });
    if (!tripId || !seatNumbers || !Array.isArray(seatNumbers) || seatNumbers.length === 0) {
      return res.status(400).json({ error: 'Trip ID and seat numbers are required' });
    }

    // Check passenger wallet balance
    const passenger = await prisma.passenger.findUnique({ where: { id: passengerId } });
    if (!passenger) return res.status(404).json({ error: 'Passenger profile not found' });
    if (passenger.walletBalance < totalAmount) {
      return res.status(400).json({ error: 'Insufficient wallet balance' });
    }

    // Check if seats are already booked
    const existingTickets = await prisma.ticket.findMany({
      where: {
        booking: {
          tripId: tripId,
          status: BookingStatus.CONFIRMED,
        },
        seatNumber: { in: seatNumbers },
        status: TicketStatus.BOOKED,
      },
    });

    if (existingTickets.length > 0) {
      const bookedSeats = existingTickets.map((t) => t.seatNumber).join(', ');
      return res.status(400).json({ error: `Seat(s) ${bookedSeats} are already booked.` });
    }

    // Transaction to deduct wallet and create booking + tickets
    const result = await prisma.$transaction(async (tx) => {
      // 1. Deduct wallet balance
      const updatedPassenger = await tx.passenger.update({
        where: { id: passengerId },
        data: { walletBalance: { decrement: totalAmount } },
      });

      // 2. Create booking record
      const booking = await tx.booking.create({
        data: {
          passengerId,
          tripId,
          totalAmount,
          status: BookingStatus.CONFIRMED,
        },
      });

      // 3. Create individual tickets with unique QR code strings
      const tickets = [];
      for (const seat of seatNumbers) {
        const ticketCode = `TKT-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
        const qrCodeString = JSON.stringify({
          ticketCode,
          seatNumber: seat,
          tripId,
          passengerName: passenger.name,
        });

        const ticket = await tx.ticket.create({
          data: {
            bookingId: booking.id,
            ticketCode,
            seatNumber: seat,
            qrCodeString,
            status: TicketStatus.BOOKED,
          },
        });
        tickets.push(ticket);
      }

      return { booking, tickets, updatedPassenger };
    });

    // Create Audit Log
    await prisma.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'BOOKING_CREATE',
        details: `Created booking ${result.booking.id} for trip ${tripId}. Amount: ${totalAmount}`,
      },
    });

    res.status(201).json({
      message: 'Booking confirmed successfully',
      booking: result.booking,
      tickets: result.tickets,
      walletBalance: result.updatedPassenger.walletBalance,
    });
  } catch (error: any) {
    console.error('Booking error:', error);
    res.status(500).json({ error: error.message || 'Error processing booking' });
  }
});

// 2. GET BOOKING HISTORY (Passenger)
router.get('/history', authenticateJWT, requireRoles([UserRole.PASSENGER]), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const passengerId = req.user?.passengerId;
    if (!passengerId) return res.status(400).json({ error: 'No passenger profile linked' });

    const bookings = await prisma.booking.findMany({
      where: { passengerId },
      include: {
        trip: {
          include: {
            route: true,
            bus: true,
          },
        },
        tickets: true,
      },
      orderBy: { bookingTime: 'desc' },
    });

    res.json(bookings);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching bookings' });
  }
});

// 3. CANCEL BOOKING / TICKET
router.post('/tickets/:id/cancel', authenticateJWT, requireRoles([UserRole.PASSENGER]), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const passengerId = req.user?.passengerId;
    if (!passengerId) return res.status(400).json({ error: 'No passenger profile linked' });

    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: {
        booking: {
          include: { trip: true },
        },
      },
    });

    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    if (ticket.booking.passengerId !== passengerId) {
      return res.status(403).json({ error: 'You do not own this ticket' });
    }
    if (ticket.status === TicketStatus.CANCELLED) {
      return res.status(400).json({ error: 'Ticket is already cancelled' });
    }

    // Cancel ticket and refund fare portion
    const refundAmount = ticket.booking.totalAmount / (await prisma.ticket.count({ where: { bookingId: ticket.bookingId } }));

    const result = await prisma.$transaction(async (tx) => {
      const updatedTicket = await tx.ticket.update({
        where: { id },
        data: { status: TicketStatus.CANCELLED },
      });

      const updatedPassenger = await tx.passenger.update({
        where: { id: passengerId },
        data: { walletBalance: { increment: refundAmount } },
      });

      // If all tickets in booking are cancelled, update booking status
      const activeTicketsCount = await tx.ticket.count({
        where: {
          bookingId: ticket.bookingId,
          status: TicketStatus.BOOKED,
        },
      });

      if (activeTicketsCount === 0) {
        await tx.booking.update({
          where: { id: ticket.bookingId },
          data: { status: BookingStatus.CANCELLED },
        });
      }

      return { updatedTicket, walletBalance: updatedPassenger.walletBalance };
    });

    // Create Audit Log
    await prisma.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'TICKET_CANCEL',
        details: `Cancelled ticket ${ticket.ticketCode}. Refunded: ${refundAmount}`,
      },
    });

    res.json({
      message: 'Ticket cancelled and refund processed',
      ticket: result.updatedTicket,
      walletBalance: result.walletBalance,
    });
  } catch (error) {
    console.error('Cancel ticket error:', error);
    res.status(500).json({ error: 'Error cancelling ticket' });
  }
});

// 4. BUY BUS PASS
router.post('/passes', authenticateJWT, requireRoles([UserRole.PASSENGER]), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { passType, pricePaid, durationDays } = req.body;
    const passengerId = req.user?.passengerId;
    if (!passengerId) return res.status(400).json({ error: 'No passenger profile linked' });

    const passenger = await prisma.passenger.findUnique({ where: { id: passengerId } });
    if (!passenger) return res.status(404).json({ error: 'Passenger profile not found' });
    if (passenger.walletBalance < pricePaid) {
      return res.status(400).json({ error: 'Insufficient wallet balance to buy pass' });
    }

    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + (durationDays || 30));

    const result = await prisma.$transaction(async (tx) => {
      // Deduct wallet
      await tx.passenger.update({
        where: { id: passengerId },
        data: { walletBalance: { decrement: pricePaid } },
      });

      // Create pass
      const pass = await tx.busPass.create({
        data: {
          passengerId,
          passType,
          expiryDate,
          pricePaid,
          status: PassStatus.ACTIVE,
        },
      });

      return pass;
    });

    // Log action
    await prisma.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'PASS_BUY',
        details: `Bought pass of type ${passType} for price ${pricePaid}`,
      },
    });

    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: 'Error purchasing bus pass' });
  }
});

// 5. GET ACTIVE PASS
router.get('/passes/active', authenticateJWT, requireRoles([UserRole.PASSENGER]), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const passengerId = req.user?.passengerId;
    if (!passengerId) return res.status(400).json({ error: 'No passenger profile linked' });

    const pass = await prisma.busPass.findFirst({
      where: {
        passengerId,
        status: PassStatus.ACTIVE,
        expiryDate: { gte: new Date() },
      },
      orderBy: { expiryDate: 'desc' },
    });

    res.json(pass || null);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching active pass' });
  }
});

export default router;
