import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Request, Response, NextFunction } from 'express';
import { AuthController, sessionToken } from './auth.controller';
import { AuthService } from './auth.service';
import { AppModule } from './app.module';
import { CodexCallQueue } from './codex-call-queue';

@Module({ controllers: [AuthController] })
class GatewayModule {}

export function createAuthenticatedApp(options: { directory?: string; logger?: false } = {}): Promise<INestApplication> {
  const auth = new AuthService(options.directory);
  const workspaces = new Map<string, Promise<INestApplication>>();
  const streams = new Map<Response, string>();
  const queue = new CodexCallQueue();
  let closing = false;
  const sweep = setInterval(() => {
    for (const [response, token] of streams) if (!auth.user(token)) response.end();
  }, 30_000);
  sweep.unref();
  const lifecycle = {
    beforeApplicationShutdown: () => {
      closing = true; clearInterval(sweep); for (const response of streams.keys()) response.end();
      return Promise.allSettled([...workspaces.values()].map(workspace => workspace.then(instance => instance.close())))
        .then(() => { auth.close(); });
    }
  };
  return NestFactory.create({ module: GatewayModule, providers: [{ provide: AuthService, useValue: auth }, { provide: 'WORKSPACE_SHUTDOWN', useValue: lifecycle }] }, { logger: options.logger, abortOnError: false })
    .then(app => {
      app.setGlobalPrefix('api');
      /* 网关先验证会话，再进入账号专属应用；所有业务路由、文件与 SSE 共用同一边界。 */
      app.use((request: Request, response: Response, next: NextFunction) => {
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        const publicOrigin = process.env.PHOTO_STUDIO_PUBLIC_ORIGIN;
        if (publicOrigin?.startsWith('https://')) response.setHeader('Strict-Transport-Security', 'max-age=86400');
        const path = request.path;
        if (path !== '/api' && !path.startsWith('/api/')) { next(); return; }
        if (closing) { response.status(503).json({ message: '服务正在停止，请稍后重试。' }); return; }
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
          const origin = request.headers.origin;
          let validOrigin = true;
          if (origin) {
            try { validOrigin = publicOrigin ? new URL(origin).origin === new URL(publicOrigin).origin : new URL(origin).host === request.headers.host; }
            catch { validOrigin = false; }
          }
          if (request.headers['x-photo-studio-request'] !== '1' || !validOrigin) { response.status(403).json({ message: '请求来源无效，请刷新页面后重试。' }); return; }
        }
        if (path === '/api/health' && request.method === 'GET') {
          const user = auth.user(sessionToken(request));
          response.json({ status: 'ready', storage: 'sqlite', dataDirectory: user?.role === 'admin' ? auth.workspace(user) : '' }); return;
        }
        if (path.startsWith('/api/auth/')) {
          if (path === '/api/auth/logout') {
            const token = sessionToken(request);
            for (const [stream, current] of streams) if (current === token) stream.end();
          }
          next(); return;
        }
        const token = sessionToken(request); const user = auth.user(token);
        if (!user) { response.status(401).json({ message: '请登录后继续使用。' }); return; }
        if (user.role !== 'admin' && ['/api/codex/status', '/api/image-tools/status'].includes(path.toLowerCase().replace(/\/+$/, ''))) { response.status(403).json({ message: '此操作仅供管理员使用。' }); return; }
        if (!workspaces.has(user.id)) {
          const pending = NestFactory.create(AppModule.forWorkspace(auth.workspace(user), queue), { logger: options.logger, abortOnError: false })
            .then(workspace => { workspace.setGlobalPrefix('api'); return workspace.init().then(() => workspace).catch(error => workspace.close().then(() => { throw error; })); });
          workspaces.set(user.id, pending);
          pending.catch(() => workspaces.delete(user.id));
        }
        workspaces.get(user.id)!.then(workspace => {
          if (closing || !auth.user(token)) { response.status(401).json({ message: '登录已失效，请重新登录。' }); return; }
          if (request.headers.accept?.includes('text/event-stream')) {
            streams.set(response, token!); response.once('close', () => streams.delete(response));
          }
          workspace.getHttpAdapter().getInstance()(request, response, next);
        }).catch(() => { if (!response.headersSent) response.status(503).json({ message: '暂时无法打开创作空间，请稍后重试。' }); });
      });
      /* 生产构建直接同源提供前端；穿透只需指向本机 3000，开发时仍使用 Vite 代理。 */
      const webDirectory = resolve(__dirname, '../../web/dist');
      if (existsSync(resolve(webDirectory, 'index.html'))) {
        (app.getHttpAdapter() as ExpressAdapter).useStaticAssets(webDirectory, { index: false });
        app.use((request: Request, response: Response, next: NextFunction) => {
          if (request.method === 'GET' && request.path !== '/api' && !request.path.startsWith('/api/')) response.sendFile(resolve(webDirectory, 'index.html'));
          else next();
        });
      }
      return app;
    }).catch(error => { clearInterval(sweep); auth.close(); throw error; });
}
