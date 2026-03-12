const net = require('net');

const start = Number.parseInt(process.env.PORT_START || '', 10) || 9480;
const end = Number.parseInt(process.env.PORT_END || '', 10) || (start + 50);
const host = process.env.PORT_HOST || '127.0.0.1';

const check = (port) => new Promise((resolve) => {
  const server = net.createServer();
  server.unref();
  server.on('error', () => resolve(false));
  server.listen({ port, host }, () => server.close(() => resolve(true)));
});

async function main() {
  for (let port = start; port <= end; port += 1) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await check(port);
    if (ok) {
      process.stdout.write(String(port));
      return;
    }
  }
  console.error(`No free port found in range ${start}-${end} on ${host}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
