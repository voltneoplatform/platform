import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { normaliseIndianMobile, type StaffProfile } from '@voltneo/shared';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { toStaffProfile } from '../auth/auth.service';
import type { AuthenticatedStaff, RequestMeta } from '../common/decorators';
import type { CreateStaffDto, ListStaffQuery, UpdateStaffDto } from './dto';

function normaliseContact(email: string | null | undefined, phone: string | null | undefined) {
  const out: { email?: string | null; phone?: string | null } = {};
  if (email !== undefined) out.email = email === null ? null : email.toLowerCase();
  if (phone !== undefined) {
    if (phone === null) out.phone = null;
    else {
      const p = normaliseIndianMobile(phone);
      if (!p) throw new BadRequestException('Phone must be a 10-digit Indian mobile number');
      out.phone = p;
    }
  }
  return out;
}

function duplicateMessage(err: unknown): string | null {
  // Two people changed related staff records at the same moment; one must retry.
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
    return 'Someone else changed staff records at the same time. Reload and try again.';
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    const target = JSON.stringify(err.meta ?? {});
    if (target.includes('email')) return 'Another staff member already uses this email';
    if (target.includes('phone')) return 'Another staff member already uses this phone number';
    return 'Another staff member already uses this email or phone number';
  }
  return null;
}

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(q: ListStaffQuery): Promise<StaffProfile[]> {
    const rows = await this.prisma.staffUser.findMany({
      where: {
        role: q.role,
        status: q.status,
        OR: q.search
          ? [
              { name: { contains: q.search, mode: 'insensitive' } },
              { email: { contains: q.search.toLowerCase() } },
              { phone: { contains: q.search.replace(/\D/g, '') || q.search } },
            ]
          : undefined,
      },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toStaffProfile);
  }

  async get(id: string): Promise<StaffProfile> {
    const row = await this.prisma.staffUser.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Staff member not found');
    return toStaffProfile(row);
  }

  async create(
    dto: CreateStaffDto,
    actor: AuthenticatedStaff,
    meta: RequestMeta,
  ): Promise<StaffProfile> {
    const contact = normaliseContact(dto.email, dto.phone);
    if (!contact.email && !contact.phone) {
      throw new BadRequestException(
        'Give an email or a phone number so the staff member can receive login codes',
      );
    }
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.staffUser.create({
          data: {
            name: dto.name,
            email: contact.email ?? null,
            phone: contact.phone ?? null,
            role: dto.role,
            createdById: actor.id,
          },
        });
        await this.audit.record(
          {
            actorType: 'STAFF',
            actorId: actor.id,
            action: 'staff.create',
            tableName: 'staff_users',
            recordId: created.id,
            after: toStaffProfile(created),
            ip: meta.ip,
            requestId: meta.requestId,
          },
          tx,
        );
        return created;
      });
      return toStaffProfile(row);
    } catch (err) {
      const msg = duplicateMessage(err);
      if (msg) throw new ConflictException(msg);
      throw err;
    }
  }

  async update(
    id: string,
    dto: UpdateStaffDto,
    actor: AuthenticatedStaff,
    meta: RequestMeta,
  ): Promise<StaffProfile> {
    const contact = normaliseContact(dto.email, dto.phone);
    try {
      const row = await this.prisma.$transaction(
        async (tx) => {
          const before = await tx.staffUser.findUnique({ where: { id } });
          if (!before) throw new NotFoundException('Staff member not found');

          const isSelf = id === actor.id;
          if (isSelf && dto.status === 'DEACTIVATED')
            throw new ForbiddenException('You cannot deactivate your own account');
          if (isSelf && dto.role && dto.role !== before.role)
            throw new ForbiddenException('You cannot change your own role');

          const nextEmail = contact.email !== undefined ? contact.email : before.email;
          const nextPhone = contact.phone !== undefined ? contact.phone : before.phone;
          if (!nextEmail && !nextPhone) {
            throw new BadRequestException('A staff member needs an email or a phone number');
          }

          // Never leave Volt Neo without an active super admin.
          const losesSuperAdmin =
            before.role === 'SUPER_ADMIN' &&
            before.status === 'ACTIVE' &&
            ((dto.role && dto.role !== 'SUPER_ADMIN') || dto.status === 'DEACTIVATED');
          if (losesSuperAdmin) {
            const others = await tx.staffUser.count({
              where: { role: 'SUPER_ADMIN', status: 'ACTIVE', id: { not: id } },
            });
            if (others === 0)
              throw new ForbiddenException('At least one active super admin must remain');
          }

          const deactivating = dto.status === 'DEACTIVATED' && before.status === 'ACTIVE';
          const reactivating = dto.status === 'ACTIVE' && before.status === 'DEACTIVATED';
          const after = await tx.staffUser.update({
            where: { id },
            data: {
              name: dto.name,
              ...contact,
              role: dto.role,
              status: dto.status,
              deactivatedAt: deactivating ? new Date() : reactivating ? null : undefined,
            },
          });

          // A deactivated account loses every session at once, and so does a role change,
          // so the person logs in again with the new permissions.
          const roleChanged = dto.role !== undefined && dto.role !== before.role;
          if (deactivating || roleChanged) {
            await tx.staffSession.updateMany({
              where: { staffId: id, revokedAt: null },
              data: {
                revokedAt: new Date(),
                revokedReason: deactivating ? 'staff_deactivated' : 'role_changed',
              },
            });
          }

          const action = deactivating
            ? 'staff.deactivate'
            : reactivating
              ? 'staff.reactivate'
              : roleChanged
                ? 'staff.role_change'
                : 'staff.update';
          await this.audit.record(
            {
              actorType: 'STAFF',
              actorId: actor.id,
              action,
              tableName: 'staff_users',
              recordId: id,
              before: toStaffProfile(before),
              after: toStaffProfile(after),
              ip: meta.ip,
              requestId: meta.requestId,
            },
            tx,
          );
          return after;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return toStaffProfile(row);
    } catch (err) {
      const msg = duplicateMessage(err);
      if (msg) throw new ConflictException(msg);
      throw err;
    }
  }
}
