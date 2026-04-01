import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { WebSocketServer } from 'ws';
import type { ServerConfig, ServerState } from './types.ts';
import { handleHttpRequest } from './http.ts';
import { handleConnection } from './protocol.ts';
import { ProfileStore } from './profiles.ts';
import { ThemeStore } from './themes.ts';
import { ShellStore } from './shells.ts';
import { SessionRegistry } from './sessions.ts';
import type { Logger } from './logger.ts';

export function startServer(config: ServerConfig, logger: Logger): void {
  const profileStore = new ProfileStore(config.dataFolder);
  profileStore.ensureDefaults();

  const themeStore = new ThemeStore(config.dataFolder);
  themeStore.ensureDefaults();

  const shellStore = new ShellStore(config.dataFolder);
  shellStore.ensureDefaults();
  shellStore.rediscover();

  const registry = new SessionRegistry(config.dataFolder, logger);
  registry.init();

  const state: ServerState = {
    clientCount: 0,
    config,
  };

  const handler = (req: IncomingMessage, res: ServerResponse) => {
    handleHttpRequest(req, res, profileStore, themeStore, shellStore, registry);
  };

  const httpServer = config.tls !== undefined
    ? createHttpsServer({ cert: config.tls.cert, key: config.tls.key, ca: config.tls.ca }, handler)
    : createHttpServer(handler);

  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    perMessageDeflate: {
      threshold: 256,
    },
  });

  wss.on('connection', (ws, req) => {
    handleConnection(ws, req, state, registry, shellStore, logger);
  });

  httpServer.listen(config.port, config.host, () => {
    const scheme = config.tls !== undefined ? 'https' : 'http';
    logger.info(`Listening on ${scheme}://${config.host}:${config.port}`);
    const shells = shellStore.list();
    logger.info(`shells: ${shells.map(s => s.name).join(', ') || '(none discovered)'}`);

  });

  const shutdown = () => {
    logger.info('shutting down...');
    registry.destroyAll();
    wss.clients.forEach((ws) => ws.close(1001, 'Server shutting down'));
    wss.close();
    httpServer.close(() => {
      logger.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 3000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
