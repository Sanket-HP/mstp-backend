import { PrismaClient, UserRole, DriverStatus, ConductorStatus, BusStatus, TripStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // 1. Create Roles
  const roles = await Promise.all(
    Object.values(UserRole).map((role) =>
      prisma.role.upsert({
        where: { name: role },
        update: {},
        create: {
          name: role,
          description: `${role.replace('_', ' ')} role for MSTP`,
        },
      })
    )
  );
  console.log('Roles seeded.');

  // 2. Hash passwords
  const salt = await bcrypt.genSalt(10);
  const adminPassword = await bcrypt.hash('admin123', salt);
  const managerPassword = await bcrypt.hash('manager123', salt);
  const driverPassword = await bcrypt.hash('driver123', salt);
  const conductorPassword = await bcrypt.hash('conductor123', salt);
  const passengerPassword = await bcrypt.hash('passenger123', salt);

  // 3. Create Depots
  const mumbaiDepot = await prisma.depot.upsert({
    where: { name: 'Mumbai Central Depot' },
    update: {},
    create: {
      name: 'Mumbai Central Depot',
      locationName: 'Mumbai Central, Mumbai',
      latitude: 18.9696,
      longitude: 72.8193,
      contactNumber: '+91 22 2307 2637',
    },
  });

  const puneDepot = await prisma.depot.upsert({
    where: { name: 'Pune Swargate Depot' },
    update: {},
    create: {
      name: 'Pune Swargate Depot',
      locationName: 'Swargate, Pune',
      latitude: 18.5018,
      longitude: 73.8636,
      contactNumber: '+91 20 2444 0417',
    },
  });

  console.log('Depots seeded.');

  // 4. Create Users (with profiles where applicable)
  // Admin
  const adminUser = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      password: adminPassword,
      name: 'MSRTC Admin',
      role: UserRole.ADMIN,
      email: 'admin@mstp.maharashtra.gov.in',
      mobile: '9876543210',
    },
  });

  // Depot Manager
  const managerUser = await prisma.user.upsert({
    where: { username: 'manager' },
    update: {},
    create: {
      username: 'manager',
      password: managerPassword,
      name: 'Ramesh Patil (Depot Manager)',
      role: UserRole.DEPOT_MANAGER,
      email: 'manager.mumbai@mstp.maharashtra.gov.in',
      mobile: '9876543211',
      employeeId: 'M-1001',
    },
  });

  // Driver
  const driverUser = await prisma.user.upsert({
    where: { username: 'driver' },
    update: {},
    create: {
      username: 'driver',
      password: driverPassword,
      name: 'Vijay Shinde (Driver)',
      role: UserRole.DRIVER,
      email: 'vijay.shinde@mstp.maharashtra.gov.in',
      mobile: '9876543212',
      employeeId: 'D-2001',
    },
  });

  const driverProfile = await prisma.driver.upsert({
    where: { employeeId: 'D-2001' },
    update: {},
    create: {
      userId: driverUser.id,
      employeeId: 'D-2001',
      licenseNumber: 'MH-12-DL-20220938',
      status: DriverStatus.OFF_DUTY,
    },
  });

  // Conductor
  const conductorUser = await prisma.user.upsert({
    where: { username: 'conductor' },
    update: {},
    create: {
      username: 'conductor',
      password: conductorPassword,
      name: 'Anil Kamble (Conductor)',
      role: UserRole.CONDUCTOR,
      email: 'anil.kamble@mstp.maharashtra.gov.in',
      mobile: '9876543213',
      employeeId: 'C-3001',
    },
  });

  const conductorProfile = await prisma.conductor.upsert({
    where: { employeeId: 'C-3001' },
    update: {},
    create: {
      userId: conductorUser.id,
      employeeId: 'C-3001',
      status: ConductorStatus.OFF_DUTY,
    },
  });

  // Passenger
  const passengerUser = await prisma.user.upsert({
    where: { username: 'passenger' },
    update: {},
    create: {
      username: 'passenger',
      password: passengerPassword,
      name: 'Rahul More (Passenger)',
      role: UserRole.PASSENGER,
      email: 'rahul.more@gmail.com',
      mobile: '9876543214',
    },
  });

  const passengerProfile = await prisma.passenger.upsert({
    where: { userId: passengerUser.id },
    update: {},
    create: {
      userId: passengerUser.id,
      name: 'Rahul More',
      mobile: '9876543214',
      email: 'rahul.more@gmail.com',
      walletBalance: 500.0,
    },
  });

  console.log('Users and Roles seeded.');

  // 5. Create Routes & Stops
  const routeMumbaiPune = await prisma.route.upsert({
    where: { routeNumber: 'M-101' },
    update: {},
    create: {
      routeNumber: 'M-101',
      source: 'Mumbai Central',
      destination: 'Swargate (Pune)',
      distanceKm: 150,
      durationMinutes: 180,
    },
  });

  const stops = [
    { name: 'Mumbai Central Depot', sequence: 1, lat: 18.9696, lng: 72.8193, stage: true },
    { name: 'Vashi Plaza', sequence: 2, lat: 19.0392, lng: 73.0003, stage: false },
    { name: 'Lonavala ST Stand', sequence: 3, lat: 18.7541, lng: 73.4069, stage: true },
    { name: 'Pune Swargate Depot', sequence: 4, lat: 18.5018, lng: 73.8636, stage: true },
  ];

  for (const stop of stops) {
    await prisma.stop.upsert({
      where: { routeId_sequence: { routeId: routeMumbaiPune.id, sequence: stop.sequence } },
      update: {},
      create: {
        routeId: routeMumbaiPune.id,
        name: stop.name,
        sequence: stop.sequence,
        latitude: stop.lat,
        longitude: stop.lng,
        fareStage: stop.stage,
      },
    });
  }

  console.log('Route M-101 and Stops seeded.');

  // 6. Create Buses
  const bus1 = await prisma.bus.upsert({
    where: { registrationNumber: 'MH-12-KF-4567' },
    update: {},
    create: {
      registrationNumber: 'MH-12-KF-4567',
      model: 'Tata Marcopolo BS6 (Express Coach)',
      capacity: 45,
      status: BusStatus.ACTIVE,
      depotId: puneDepot.id,
    },
  });

  const bus2 = await prisma.bus.upsert({
    where: { registrationNumber: 'MH-14-GP-8899' },
    update: {},
    create: {
      registrationNumber: 'MH-14-GP-8899',
      model: 'Ashok Leyland Viking (Shivshahi AC)',
      capacity: 40,
      status: BusStatus.ACTIVE,
      depotId: mumbaiDepot.id,
    },
  });

  console.log('Buses seeded.');

  // 7. Create Trips
  const trip1 = await prisma.trip.upsert({
    where: { tripNumber: 'TR-5001' },
    update: {},
    create: {
      tripNumber: 'TR-5001',
      routeId: routeMumbaiPune.id,
      busId: bus1.id,
      driverId: driverProfile.id,
      conductorId: conductorProfile.id,
      scheduledStart: new Date(new Date().setHours(8, 0, 0, 0)),
      scheduledEnd: new Date(new Date().setHours(11, 0, 0, 0)),
      status: TripStatus.SCHEDULED,
    },
  });

  const trip2 = await prisma.trip.upsert({
    where: { tripNumber: 'TR-5002' },
    update: {},
    create: {
      tripNumber: 'TR-5002',
      routeId: routeMumbaiPune.id,
      busId: bus2.id,
      driverId: driverProfile.id,
      conductorId: conductorProfile.id,
      scheduledStart: new Date(new Date().setHours(14, 0, 0, 0)),
      scheduledEnd: new Date(new Date().setHours(17, 0, 0, 0)),
      status: TripStatus.SCHEDULED,
    },
  });

  console.log('Trips seeded.');

  console.log('Database Seeding Completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
