import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { tokenHash } from '../auth/auth.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const categoryKeys = [
  'expiryAlertsEnabled',
  'lowStockAlertsEnabled',
  'shoppingRemindersEnabled',
  'dailyDigestEnabled',
  'householdEventsEnabled',
] as const;
type CategoryKey = (typeof categoryKeys)[number];
type PreferenceUpdate = Partial<Record<CategoryKey, boolean>> & {
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
};

const defaults = {
  expiryAlertsEnabled: false,
  lowStockAlertsEnabled: false,
  shoppingRemindersEnabled: false,
  dailyDigestEnabled: false,
  householdEventsEnabled: false,
  quietHours: null as { start: string; end: string } | null,
  timezone: 'Asia/Ho_Chi_Minh',
};

function object(value: unknown, reason: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException(reason);
  return value as Record<string, unknown>;
}

function preferenceUpdate(input: unknown): PreferenceUpdate {
  const body = object(input, 'INVALID_NOTIFICATION_PREFERENCE');
  const allowed = new Set<string>([...categoryKeys, 'quietHours']);
  if (
    !Object.keys(body).length ||
    Object.keys(body).some((key) => !allowed.has(key))
  )
    throw new BadRequestException('INVALID_NOTIFICATION_PREFERENCE');
  const data: PreferenceUpdate = {};
  for (const key of categoryKeys) {
    if (!(key in body)) continue;
    if (typeof body[key] !== 'boolean')
      throw new BadRequestException('INVALID_NOTIFICATION_PREFERENCE');
    data[key] = body[key];
  }
  if ('quietHours' in body) {
    if (body.quietHours === null) {
      data.quietHoursStart = null;
      data.quietHoursEnd = null;
    } else {
      const quiet = object(body.quietHours, 'INVALID_QUIET_HOURS');
      if (
        Object.keys(quiet).length !== 2 ||
        typeof quiet.start !== 'string' ||
        typeof quiet.end !== 'string' ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(quiet.start) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(quiet.end) ||
        quiet.start === quiet.end
      )
        throw new BadRequestException('INVALID_QUIET_HOURS');
      data.quietHoursStart = quiet.start;
      data.quietHoursEnd = quiet.end;
    }
  }
  return data;
}

function endpoint(input: unknown): string {
  if (
    typeof input !== 'string' ||
    input.length < 10 ||
    input.length > 2048 ||
    /[^\x21-\x7e]/.test(input)
  )
    throw new BadRequestException('INVALID_PUSH_SUBSCRIPTION');
  try {
    const url = new URL(input);
    if (
      url.protocol !== 'https:' ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new Error('Invalid endpoint');
  } catch {
    throw new BadRequestException('INVALID_PUSH_SUBSCRIPTION');
  }
  return input;
}

function endpointRequest(input: unknown): string {
  const body = object(input, 'INVALID_PUSH_SUBSCRIPTION');
  if (Object.keys(body).length !== 1 || !('endpoint' in body))
    throw new BadRequestException('INVALID_PUSH_SUBSCRIPTION');
  return endpoint(body.endpoint);
}

function key(input: unknown, maxLength: number, decodedLength: number): string {
  if (
    typeof input !== 'string' ||
    input.length > maxLength ||
    !/^[A-Za-z0-9_-]+={0,2}$/.test(input) ||
    Buffer.from(input, 'base64url').length !== decodedLength
  )
    throw new BadRequestException('INVALID_PUSH_SUBSCRIPTION');
  return input;
}

function subscription(input: unknown) {
  const body = object(input, 'INVALID_PUSH_SUBSCRIPTION');
  if (Object.keys(body).some((field) => !['endpoint', 'keys'].includes(field)))
    throw new BadRequestException('INVALID_PUSH_SUBSCRIPTION');
  const keys = object(body.keys, 'INVALID_PUSH_SUBSCRIPTION');
  if (Object.keys(keys).some((field) => !['p256dh', 'auth'].includes(field)))
    throw new BadRequestException('INVALID_PUSH_SUBSCRIPTION');
  const p256dh = key(keys.p256dh, 512, 65);
  if (Buffer.from(p256dh, 'base64url')[0] !== 4)
    throw new BadRequestException('INVALID_PUSH_SUBSCRIPTION');
  return {
    endpoint: endpoint(body.endpoint),
    p256dh,
    auth: key(keys.auth, 128, 16),
  };
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  private presentPreference(row: {
    expiryAlertsEnabled: boolean;
    lowStockAlertsEnabled: boolean;
    shoppingRemindersEnabled: boolean;
    dailyDigestEnabled: boolean;
    householdEventsEnabled: boolean;
    quietHoursStart: string | null;
    quietHoursEnd: string | null;
  }) {
    return {
      expiryAlertsEnabled: row.expiryAlertsEnabled,
      lowStockAlertsEnabled: row.lowStockAlertsEnabled,
      shoppingRemindersEnabled: row.shoppingRemindersEnabled,
      dailyDigestEnabled: row.dailyDigestEnabled,
      householdEventsEnabled: row.householdEventsEnabled,
      quietHours:
        row.quietHoursStart && row.quietHoursEnd
          ? { start: row.quietHoursStart, end: row.quietHoursEnd }
          : null,
      timezone: defaults.timezone,
    };
  }

  async preferences(userId: string) {
    const row = await this.prisma.notificationPreference.findUnique({
      where: { userId },
    });
    return row ? this.presentPreference(row) : { ...defaults };
  }

  async updatePreferences(userId: string, input: unknown) {
    const data = preferenceUpdate(input);
    const row = await this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return this.presentPreference(row);
  }

  async register(userId: string, sessionToken: string, input: unknown) {
    const values = subscription(input);
    const sessionTokenHash = tokenHash(sessionToken);
    try {
      await this.prisma.$transaction(async (tx) => {
        const session = await tx.userSession.findUnique({
          where: { tokenHash: sessionTokenHash },
          select: { userId: true, expiresAt: true },
        });
        if (
          !session ||
          session.userId !== userId ||
          session.expiresAt <= new Date()
        )
          throw new UnauthorizedException('Sign in to continue.');
        await tx.pushSubscription.upsert({
          where: { endpoint: values.endpoint },
          create: { ...values, sessionTokenHash },
          update: {
            p256dh: values.p256dh,
            auth: values.auth,
            sessionTokenHash,
          },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      )
        throw new UnauthorizedException('Sign in to continue.');
      throw error;
    }
    return { registered: true };
  }

  async remove(sessionToken: string, input: unknown) {
    const result = await this.prisma.pushSubscription.deleteMany({
      where: {
        endpoint: endpointRequest(input),
        sessionTokenHash: tokenHash(sessionToken),
      },
    });
    return { removed: result.count > 0 };
  }

  async status(sessionToken: string, input: unknown) {
    const registered = await this.prisma.pushSubscription.count({
      where: {
        endpoint: endpointRequest(input),
        sessionTokenHash: tokenHash(sessionToken),
        session: { expiresAt: { gt: new Date() } },
      },
    });
    return { registered: registered > 0 };
  }

  // Internal delivery boundary; never expose these credentials through HTTP.
  deliverySubscriptions(userId: string, now = new Date()) {
    return this.prisma.pushSubscription.findMany({
      where: { session: { userId, expiresAt: { gt: now } } },
      select: { endpoint: true, p256dh: true, auth: true },
    });
  }
}
