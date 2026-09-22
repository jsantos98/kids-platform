import { defineConfig, type Plugin, type ViteDevServer } from 'vite';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = 8321;

// Dev-only endpoint the pages use to persist canvas captures:
// POST /save?name=x.png with a PNG data-URL body → concept-art/x.png
function capturePlugin(): Plugin {
  const save = async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const name = (url.searchParams.get('name') ?? 'shot.png').replace(/[^\w.-]/g, '');
    let body = '';
    for await (const chunk of req) body += chunk;
    const b64 = body.includes(',') ? body.split(',')[1] : body;
    const outDir = path.join(ROOT, 'concept-art');
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, name), Buffer.from(b64, 'base64'));
    res.end('saved ' + name);
    console.log('[save]', name, b64.length, 'bytes b64');
  };
  return {
    name: 'capture-endpoint',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/save', (req, res) => void save(req, res));
    },
    configurePreviewServer(server) {
      server.middlewares.use('/save', (req, res) => void save(req, res));
    },
  };
}

export default defineConfig({
  base: './',
  server: { port: PORT },
  preview: { port: PORT },
  plugins: [capturePlugin()],
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(ROOT, 'index.html'),
        city: path.resolve(ROOT, 'play/city.html'),
        firetruck: path.resolve(ROOT, 'diorama/firetruck.html'),
        helicopter: path.resolve(ROOT, 'diorama/helicopter.html'),
        train: path.resolve(ROOT, 'diorama/train.html'),
      },
    },
  },
});
