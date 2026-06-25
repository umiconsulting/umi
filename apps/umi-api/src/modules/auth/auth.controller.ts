import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../../shared/config/config.schema';
import { AuthService, type LoginResult } from './auth.service';
import { AuthGuard } from './auth.guard';
import { buildCookieOptions } from './cookies';
import { CurrentUser } from './current-user.decorator';
import { Public } from './public.decorator';
import {
  ACCESS_COOKIE,
  CSRF_COOKIE,
  REFRESH_COOKIE,
  type AuthUser,
} from './auth.types';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

/**
 * Auth ingress (D9). Issues/clears the httpOnly JWT cookies and returns the
 * session body the dashboard frontend renders. Cookie wiring lives here; the
 * service stays transport-agnostic.
 */
@UseGuards(AuthGuard)
@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  @Public()
  @Post('local/login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ session: SessionEnvelope }> {
    const result = await this.auth.login(dto.username, dto.password);
    this.setAuthCookies(reply, result);
    return { session: toSession(result) };
  }

  @Public()
  @Post('local/refresh')
  async refresh(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ session: SessionEnvelope }> {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw new UnauthorizedException('authentication_required');
    const result = await this.auth.refresh(token);
    this.setAuthCookies(reply, result);
    return { session: toSession(result) };
  }

  @Public()
  @Post('local/logout')
  logout(@Res({ passthrough: true }) reply: FastifyReply): { ok: true } {
    for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, CSRF_COOKIE]) {
      reply.clearCookie(name, { path: '/' });
    }
    return { ok: true };
  }

  @Public()
  @Post('local/forgot-password')
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
  ): Promise<{ ok: true }> {
    await this.auth.forgotPassword(dto.email);
    return { ok: true };
  }

  @Public()
  @Post('local/reset-password')
  async resetPassword(
    @Body() dto: ResetPasswordDto,
  ): Promise<{ ok: true }> {
    await this.auth.resetPassword(dto.token, dto.password);
    return { ok: true };
  }

  /** Cookie-based session bootstrap for the SPA (authed). */
  @Get('me')
  async me(@CurrentUser() user: AuthUser): Promise<{ session: SessionEnvelope }> {
    const session = await this.auth.session(user.id);
    return { session: { ...session, provider: 'local' } };
  }

  private setAuthCookies(reply: FastifyReply, result: LoginResult): void {
    reply.setCookie(
      ACCESS_COOKIE,
      result.accessToken,
      buildCookieOptions(this.config, 'access'),
    );
    reply.setCookie(
      REFRESH_COOKIE,
      result.refreshToken,
      buildCookieOptions(this.config, 'refresh'),
    );
    // Double-submit CSRF token: readable cookie, echoed by the SPA in a header
    // on mutations (CsrfGuard wiring is a follow-up; the token is issued now).
    reply.setCookie(
      CSRF_COOKIE,
      randomBytes(18).toString('hex'),
      buildCookieOptions(this.config, 'csrf'),
    );
  }
}

interface SessionEnvelope {
  user: { id: string; email: string; displayName: string | null };
  tenants: LoginResult['tenants'];
  provider: 'local';
}

function toSession(result: LoginResult): SessionEnvelope {
  return { user: result.user, tenants: result.tenants, provider: 'local' };
}
