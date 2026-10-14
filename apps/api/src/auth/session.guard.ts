import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService, SESSION_COOKIE } from './auth.service.js';

export interface AuthenticatedRequest extends Request {
  actorId: string;
  sessionToken: string;
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookie = request.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
    const token = cookie?.slice(SESSION_COOKIE.length + 1) ?? '';
    const user = await this.auth.sessionUser(token);
    if (!user) throw new UnauthorizedException('Sign in to continue.');
    request.actorId = user.id;
    request.sessionToken = token;
    return true;
  }
}
