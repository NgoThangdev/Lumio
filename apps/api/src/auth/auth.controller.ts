import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  AuthService,
  SESSION_AGE_MS,
  SESSION_COOKIE,
  sessionTokenFromCookieHeader,
} from './auth.service.js';
import { SessionGuard } from './session.guard.js';
import type { AuthenticatedRequest } from './session.guard.js';

interface CredentialsBody {
  email?: unknown;
  password?: unknown;
}

@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private setCookie(response: Response, token: string) {
    response.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/api',
      maxAge: SESSION_AGE_MS,
    });
  }

  @Post('register')
  async register(
    @Body() body: CredentialsBody,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.register(
      body?.email,
      body?.password,
      sessionTokenFromCookieHeader(request.headers.cookie),
    );
    this.setCookie(response, result.token);
    return result.user;
  }

  @Post('sign-in')
  async signIn(
    @Body() body: CredentialsBody,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.signIn(
      body?.email,
      body?.password,
      sessionTokenFromCookieHeader(request.headers.cookie),
    );
    this.setCookie(response, result.token);
    return result.user;
  }

  @Get('me')
  @UseGuards(SessionGuard)
  async me(@Req() request: AuthenticatedRequest) {
    return this.auth.sessionUser(request.sessionToken);
  }

  @Post('sign-out')
  @UseGuards(SessionGuard)
  async signOut(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.signOut(request.sessionToken);
    response.clearCookie(SESSION_COOKIE, { path: '/api' });
    return { signedOut: true };
  }
}
