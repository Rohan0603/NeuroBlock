import { createBot } from 'mineflayer';
import { mineflayer as startViewer } from 'prismarine-viewer';
import { AgentRuntime } from '../runtime/agent_runtime.js';

const host = process.env.MINECRAFT_HOST ?? 'localhost';
const port = Number(process.env.MINECRAFT_PORT ?? 25565);
const username = process.env.MINECRAFT_USERNAME ?? 'VoxelCortexBot';
const viewerPort = Number(process.env.VIEWER_PORT ?? 3000);
const version = process.env.MINECRAFT_VERSION;

const bot = createBot({
  host,
  port,
  username,
  ...(version ? { version } : {}),
});
const runtime = new AgentRuntime(bot);

bot.once('spawn', () => {
  startViewer(bot, { port: viewerPort, firstPerson: false });
  console.log(`VoxelCortex viewer available at http://localhost:${viewerPort}`);
  void runtime.start().catch((error) => console.error('Agent runtime failed to start', error));
});

bot.on('error', (error) => console.error('Mineflayer error', error));
bot.on('kicked', (reason) => console.error('Mineflayer kicked', reason));

const shutdown = (): void => {
  void runtime.stop().catch((error) => console.error('Agent runtime shutdown failed', error));
  bot.quit('Development shutdown');
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
