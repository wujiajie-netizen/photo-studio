import { Body, Controller, Get, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthState } from '@photo-studio/shared';
import { AuthService } from './auth.service';

export function sessionToken(request: Request): string | undefined {
  return request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('photo_studio_session='))?.slice('photo_studio_session='.length);
}

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get('session')
  session(@Req() request: Request, @Res({ passthrough: true }) response: Response): AuthState {
    response.setHeader('Cache-Control', 'no-store');
    return { user: this.auth.user(sessionToken(request)), setupRequired: this.auth.setupRequired() };
  }

  @Post('login')
  login(@Body() input: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    return this.auth.login(input, request.socket.remoteAddress ?? 'unknown').then(({ user, token }) => {
      this.auth.logout(sessionToken(request));
      const secure = process.env.PHOTO_STUDIO_PUBLIC_ORIGIN?.startsWith('https://') ? '; Secure' : '';
      response.setHeader('Set-Cookie', `photo_studio_session=${token}; HttpOnly; SameSite=Lax; Path=/api; Max-Age=604800${secure}`);
      response.setHeader('Cache-Control', 'no-store');
      return { user, setupRequired: false } satisfies AuthState;
    });
  }

  @Post('logout')
  logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.auth.logout(sessionToken(request));
    const secure = process.env.PHOTO_STUDIO_PUBLIC_ORIGIN?.startsWith('https://') ? '; Secure' : '';
    response.setHeader('Set-Cookie', `photo_studio_session=; HttpOnly; SameSite=Lax; Path=/api; Max-Age=0${secure}`);
    response.setHeader('Cache-Control', 'no-store');
    return { user: null, setupRequired: this.auth.setupRequired() } satisfies AuthState;
  }
}
