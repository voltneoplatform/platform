/**
 * Creates the first super admin when the database has no staff yet.
 * Safe to run more than once: it does nothing if any staff member exists.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { normaliseIndianMobile } from '@voltneo/shared';
import { PrismaClient } from '../src/generated/prisma/client';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  try {
    const count = await prisma.staffUser.count();
    if (count > 0) {
      console.log(`Seed skipped: ${count} staff member(s) already exist.`);
      return;
    }

    const name = process.env.BOOTSTRAP_SUPER_ADMIN_NAME?.trim() || 'Volt Neo Admin';
    const email = process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL?.trim().toLowerCase() || null;
    const rawPhone = process.env.BOOTSTRAP_SUPER_ADMIN_PHONE?.trim() || null;
    const phone = rawPhone ? normaliseIndianMobile(rawPhone) : null;
    if (rawPhone && !phone)
      throw new Error('BOOTSTRAP_SUPER_ADMIN_PHONE is not a valid Indian mobile number');
    if (!email && !phone)
      throw new Error('Set BOOTSTRAP_SUPER_ADMIN_EMAIL or BOOTSTRAP_SUPER_ADMIN_PHONE');

    const admin = await prisma.$transaction(async (tx) => {
      const created = await tx.staffUser.create({
        data: { name, email, phone, role: 'SUPER_ADMIN' },
      });
      await tx.auditLog.create({
        data: {
          actorType: 'SYSTEM',
          action: 'staff.bootstrap_super_admin',
          tableName: 'staff_users',
          recordId: created.id,
          after: { name, email, phone, role: 'SUPER_ADMIN' },
        },
      });
      return created;
    });
    console.log(`Created super admin ${admin.name} (${admin.email ?? admin.phone}).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
