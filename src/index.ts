import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';

// Import Routers
import authRouter from './routes/auth';
import tripsRouter from './routes/trips';
import bookingsRouter from './routes/bookings';
import attendanceRouter from './routes/attendance';
import complaintsRouter from './routes/complaints';
import emergencyRouter from './routes/emergency';
import reportsRouter from './routes/reports';
import adminRouter from './routes/admin';

import prisma from './db';

// Load config
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: '*' }));
app.use(express.json());

// API Route Registry
app.use('/api/auth', authRouter);
app.use('/api/trips', tripsRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/attendance', attendanceRouter);
app.use('/api/complaints', complaintsRouter);
app.use('/api/emergency', emergencyRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/admin', adminRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'MSTP Transport Management Server is running.' });
});

// Setup Http Server and Socket.io
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  },
});

// Real-time tracking data store in memory (Active trip coordinates)
const liveBusLocations = new Map<string, { lat: number; lng: number; speed: number; updatedAt: Date }>();

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // 1. Join room for specific trip tracking
  socket.on('join-trip', (tripId: string) => {
    socket.join(`trip-${tripId}`);
    console.log(`Socket ${socket.id} joined room: trip-${tripId}`);
    // Emit initial location if we have it
    if (liveBusLocations.has(tripId)) {
      socket.emit('location-update', liveBusLocations.get(tripId));
    }
  });

  // 2. Leave room
  socket.on('leave-trip', (tripId: string) => {
    socket.leave(`trip-${tripId}`);
    console.log(`Socket ${socket.id} left room: trip-${tripId}`);
  });

  // 3. Driver Location Sharing Broadcast
  socket.on('share-location', ({ tripId, latitude, longitude, speed }) => {
    const locUpdate = {
      tripId,
      lat: latitude,
      lng: longitude,
      speed: speed || 40, // km/h
      updatedAt: new Date(),
    };
    // Save to memory
    liveBusLocations.set(tripId, locUpdate);

    // Broadcast to passengers tracking this trip
    io.to(`trip-${tripId}`).emit('location-update', locUpdate);

    // Broadcast to Depot Managers (all sockets)
    io.emit('depot-bus-location-update', locUpdate);
  });

  // 4. Emergency SOS Broadcast
  socket.on('send-sos', ({ tripId, type, description, latitude, longitude, reporterName }) => {
    const sosAlert = {
      alertId: `SOS-${Date.now()}`,
      tripId,
      type,
      description,
      lat: latitude,
      lng: longitude,
      reporterName,
      createdAt: new Date(),
    };
    // Broadcast SOS alert to all users (especially depot managers)
    io.emit('emergency-sos-alert', sosAlert);
    console.log(`[SOS ALERT] Broadcasted SOS of type ${type} by ${reporterName}`);
  });

  // 5. Depot Manager Broadcasts Notifications to All
  socket.on('broadcast-notification', ({ title, message, senderId }) => {
    const notification = {
      id: `NOTIF-${Date.now()}`,
      title,
      message,
      createdAt: new Date(),
    };
    // Broadcast notification to everyone
    io.emit('notification-received', notification);
    console.log(`[BROADCAST] Notification: ${title}`);
  });

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(` MSTP Transport Management Server running on port ${PORT}`);
  console.log(`=================================================`);
});
