import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { APPROVER_ROLES, canApprove, type ApprovalType, type Role } from '@voltneo/shared';
import type { ApprovalRequest, Prisma } from '../generated/prisma/client';
import type { ApprovalStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedStaff, RequestMeta } from '../common/decorators';
import { isUniqueViolation, serializable, type Tx } from '../common/util';

/**
 * What happens when a request of a given type is decided. Handlers run inside
 * the same transaction as the decision, so the action and the approval
 * succeed or fail together.
 */
export interface ApprovalHandler {
  onApprove(tx: Tx, request: ApprovalRequest, approver: AuthenticatedStaff): Promise<void>;
  /** Called when a request is rejected or cancelled, to release whatever it held. */
  onClose?(tx: Tx, request: ApprovalRequest, outcome: 'REJECTED' | 'CANCELLED'): Promise<void>;
}

export interface NewApprovalRequest {
  type: ApprovalType;
  targetTable: string;
  targetId: string;
  summary: string;
  reason: string;
  payload?: Prisma.InputJsonValue;
}

@Injectable()
export class ApprovalsService {
  private readonly handlers = new Map<ApprovalType, ApprovalHandler>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  register(type: ApprovalType, handler: ApprovalHandler): void {
    this.handlers.set(type, handler);
  }

  /** Creates a request inside the caller's transaction. */
  async create(
    tx: Tx,
    input: NewApprovalRequest,
    requester: AuthenticatedStaff,
    meta: RequestMeta,
  ): Promise<ApprovalRequest> {
    let request: ApprovalRequest;
    try {
      request = await tx.approvalRequest.create({
        data: { ...input, requestedById: requester.id },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('A request for this is already waiting for approval');
      }
      throw err;
    }
    await this.audit.record(
      {
        actorType: 'STAFF',
        actorId: requester.id,
        action: 'approval.request',
        tableName: 'approval_requests',
        recordId: request.id,
        after: request,
        ip: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
    return request;
  }

  async list(viewer: AuthenticatedStaff, q: { status?: ApprovalStatus; type?: ApprovalType }) {
    const rows = await this.prisma.approvalRequest.findMany({
      where: { status: q.status, type: q.type },
      orderBy: { requestedAt: 'desc' },
      take: 200,
    });
    const ids = [...new Set(rows.flatMap((r) => [r.requestedById, r.decidedById]).filter(Boolean))];
    const staff = await this.prisma.staffUser.findMany({
      where: { id: { in: ids as string[] } },
      select: { id: true, name: true },
    });
    const names = new Map(staff.map((s) => [s.id, s.name]));
    return rows.map((r) => ({
      ...r,
      requestedByName: names.get(r.requestedById) ?? null,
      decidedByName: r.decidedById ? (names.get(r.decidedById) ?? null) : null,
      approverRoles: APPROVER_ROLES[r.type],
      canDecide:
        r.status === 'PENDING' &&
        canApprove({
          type: r.type,
          requesterId: r.requestedById,
          approverId: viewer.id,
          approverRole: viewer.role as Role,
        }),
      isMine: r.requestedById === viewer.id,
    }));
  }

  approve(id: string, approver: AuthenticatedStaff, note: string | undefined, meta: RequestMeta) {
    return this.decide(id, approver, 'APPROVED', note, meta);
  }

  reject(id: string, approver: AuthenticatedStaff, note: string, meta: RequestMeta) {
    return this.decide(id, approver, 'REJECTED', note, meta);
  }

  async cancel(id: string, requester: AuthenticatedStaff, meta: RequestMeta) {
    return serializable(this.prisma, async (tx) => {
      const request = await this.pending(tx, id);
      if (request.requestedById !== requester.id) {
        throw new ForbiddenException('Only the person who made the request can cancel it');
      }
      const updated = await this.close(tx, request, 'CANCELLED', requester, undefined);
      await this.handlers.get(request.type)?.onClose?.(tx, updated, 'CANCELLED');
      await this.auditDecision(tx, request, updated, requester, meta);
      return updated;
    });
  }

  private async decide(
    id: string,
    approver: AuthenticatedStaff,
    outcome: 'APPROVED' | 'REJECTED',
    note: string | undefined,
    meta: RequestMeta,
  ) {
    return serializable(this.prisma, async (tx) => {
      const request = await this.pending(tx, id);
      if (request.requestedById === approver.id) {
        throw new ForbiddenException('You cannot approve or reject your own request');
      }
      if (
        !canApprove({
          type: request.type,
          requesterId: request.requestedById,
          approverId: approver.id,
          approverRole: approver.role as Role,
        })
      ) {
        throw new ForbiddenException('Your role cannot decide this kind of request');
      }
      const updated = await this.close(tx, request, outcome, approver, note);
      const handler = this.handlers.get(request.type);
      if (outcome === 'APPROVED') {
        if (!handler) throw new ConflictException('This kind of request cannot be approved yet');
        await handler.onApprove(tx, updated, approver);
      } else {
        await handler?.onClose?.(tx, updated, 'REJECTED');
      }
      await this.auditDecision(tx, request, updated, approver, meta);
      return updated;
    });
  }

  private async pending(tx: Tx, id: string): Promise<ApprovalRequest> {
    const request = await tx.approvalRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Request not found');
    if (request.status !== 'PENDING') {
      throw new ConflictException(`This request is already ${request.status.toLowerCase()}`);
    }
    return request;
  }

  private async close(
    tx: Tx,
    request: ApprovalRequest,
    status: 'APPROVED' | 'REJECTED' | 'CANCELLED',
    by: AuthenticatedStaff,
    note: string | undefined,
  ): Promise<ApprovalRequest> {
    const res = await tx.approvalRequest.updateMany({
      where: { id: request.id, status: 'PENDING' },
      data: { status, decidedById: by.id, decidedAt: new Date(), decisionNote: note ?? null },
    });
    if (res.count === 0) throw new ConflictException('This request was decided by someone else');
    return tx.approvalRequest.findUniqueOrThrow({ where: { id: request.id } });
  }

  private auditDecision(
    tx: Tx,
    before: ApprovalRequest,
    after: ApprovalRequest,
    by: AuthenticatedStaff,
    meta: RequestMeta,
  ) {
    return this.audit.record(
      {
        actorType: 'STAFF',
        actorId: by.id,
        action: `approval.${after.status.toLowerCase()}`,
        tableName: 'approval_requests',
        recordId: after.id,
        before: { status: before.status },
        after: { status: after.status, decisionNote: after.decisionNote, type: after.type },
        ip: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
  }
}
