import 'reflect-metadata';
import { createAuthenticatedApp } from './authenticated-app';

createAuthenticatedApp()
  .then((app) => {
    app.setGlobalPrefix('api');
    app.enableShutdownHooks();
    return app.listen(3000, '127.0.0.1');
  })
  .catch((error: unknown) => {
    console.error('本地服务启动失败：', error);
    process.exitCode = 1;
  });
