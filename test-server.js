const http = require('http');

const server = http.createServer((req, res) => {
  console.log(`Request from: ${req.socket.remoteAddress}`);
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`
    <html>
      <body>
        <h1>Test Server Working!</h1>
        <p>If you can see this, the connection works.</p>
        <p>Your IP: ${req.socket.remoteAddress}</p>
        <p>Time: ${new Date().toISOString()}</p>
      </body>
    </html>
  `);
});

const PORT = 8888;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Test server running on http://0.0.0.0:${PORT}`);
  console.log(`Try accessing: http://172.26.56.154:${PORT}`);
});