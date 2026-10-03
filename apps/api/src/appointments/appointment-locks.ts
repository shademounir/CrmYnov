import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

/** All appointment writers share these transaction-scoped PostgreSQL locks.
 * Stable ordering prevents AB/BA deadlocks; hash collisions only serialize more work. */
export async function lockAppointmentParticipants(tx: Prisma.TransactionClient, userIds: readonly string[]): Promise<void> {
  for (const id of [...new Set(userIds)].sort((a, b) => a.localeCompare(b, "en"))) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`appointment-participant:${id}`}, 0))`;
  }
}

export async function assertAppointmentFree(tx: Prisma.TransactionClient, userIds: readonly string[], startsAt: Date, durationMinutes: number, excludeId?: string): Promise<void> {
  const end = new Date(startsAt.valueOf() + durationMinutes * 60_000);
  const rows = await appointmentOccupations(tx, userIds, startsAt, end, excludeId);
  if (rows.length) {
    throw new ConflictException({ code: "admissions_booking_conflict" });
  }
  const blocked = await tx.admissionsWindow.findFirst({ where: { active: true, kind: "BLOCKED", startsAt: { lt: end }, endsAt: { gt: startsAt }, responsibility: { active: true, userId: { in: [...userIds] } } }, select: { id: true } });
  if (blocked) throw new ConflictException({ code: "admissions_booking_conflict" });
}

/** Exact half-open overlap in PostgreSQL; never truncate busy rows into false free slots. */
export async function appointmentOccupations(tx: Prisma.TransactionClient, userIds: readonly string[], from: Date, to: Date, excludeId?: string): Promise<Array<{ startsAt: Date; endsAt: Date }>> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return [];
  return tx.$queryRaw<Array<{ startsAt: Date; endsAt: Date }>>(Prisma.sql`
    SELECT a.starts_at AS "startsAt", a.starts_at + a.duration_minutes * INTERVAL '1 minute' AS "endsAt"
    FROM appointments a
    WHERE a.state NOT IN ('ANNULE', 'REALISE', 'ABSENT', 'REFUSE')
      AND a.starts_at < ${to}
      AND a.starts_at + a.duration_minutes * INTERVAL '1 minute' > ${from}
      ${excludeId ? Prisma.sql`AND a.id <> ${excludeId}::uuid` : Prisma.empty}
      AND (a.adviser_id IN (${Prisma.join(ids)}) OR a.organizer_id IN (${Prisma.join(ids)}) OR a.evaluator_id IN (${Prisma.join(ids)})
        OR EXISTS (SELECT 1 FROM appointment_participants p WHERE p.appointment_id = a.id AND p.user_id IN (${Prisma.join(ids)})))
  `);
}
