import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const scrypt = promisify(scryptCallback);
export const SESSION_COOKIE = 'lumio_session';
export const SESSION_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function validateCredentials(email: unknown, password: unknown) {
  if (typeof email !== 'string' || typeof password !== 'string') {
    throw new BadRequestException('Email and password are required.');
  }
  const normalizedEmail = email.trim().toLowerCase();
  if (
    normalizedEmail.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
  ) {
    throw new BadRequestException('Enter a valid email address.');
  }
  if (password.length < 8 || password.length > 128) {
    throw new BadRequestException('Password must be 8 to 128 characters.');
  }
  return { email: normalizedEmail, password };
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [algorithm, saltHex, keyHex] = stored.split('$');
  if (
    algorithm !== 'scrypt' ||
    !/^[0-9a-f]{32}$/.test(saltHex ?? '') ||
    !/^[0-9a-f]{128}$/.test(keyHex ?? '')
  ) {
    return false;
  }
  const expected = Buffer.from(keyHex, 'hex');
  const actual = (await scrypt(
    password,
    Buffer.from(saltHex, 'hex'),
    64,
  )) as Buffer;
  return timingSafeEqual(actual, expected);
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  private async createSession(userId: string) {
    const token = randomBytes(32).toString('hex');
    await this.prisma.userSession.create({
      data: {
        tokenHash: tokenHash(token),
        userId,
        expiresAt: new Date(Date.now() + SESSION_AGE_MS),
      },
    });
    return token;
  }

  async register(emailInput: unknown, passwordInput: unknown) {
    const { email, password } = validateCredentials(emailInput, passwordInput);
    const passwordHash = await hashPassword(password);
    let user: { id: string; email: string };
    try {
      user = await this.prisma.user.create({
        data: { email, passwordHash },
        select: { id: true, email: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'An account with this email already exists.',
        );
      }
      throw error;
    }
    return { user, token: await this.createSession(user.id) };
  }

  async signIn(emailInput: unknown, passwordInput: unknown) {
    const { email, password } = validateCredentials(emailInput, passwordInput);
    const account = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true },
    });
    if (!account || !(await verifyPassword(password, account.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    return {
      user: { id: account.id, email: account.email },
      token: await this.createSession(account.id),
    };
  }

  async sessionUser(token: string) {
    if (!/^[0-9a-f]{64}$/.test(token)) return null;
    const session = await this.prisma.userSession.findUnique({
      where: { tokenHash: tokenHash(token) },
      select: { expiresAt: true, user: { select: { id: true, email: true } } },
    });
    if (!session || session.expiresAt <= new Date()) return null;
    return session.user;
  }

  async signOut(token: string): Promise<void> {
    if (!/^[0-9a-f]{64}$/.test(token)) return;
    await this.prisma.userSession.deleteMany({
      where: { tokenHash: tokenHash(token) },
    });
  }
}
