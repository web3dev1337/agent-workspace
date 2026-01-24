const https = require('https');
const { URL } = require('url');

function requestJson(urlString, { method = 'GET', headers = {}, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const req = https.request(
      url,
      {
        method,
        headers: {
          accept: 'application/json',
          ...headers
        }
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode || 0;
          const ok = status >= 200 && status < 300;
          if (!ok) {
            const err = new Error(`Request failed: ${method} ${url.pathname} (${status})`);
            err.statusCode = status;
            err.body = body?.slice?.(0, 2000) || body;
            reject(err);
            return;
          }

          try {
            resolve(body ? JSON.parse(body) : null);
          } catch (error) {
            const err = new Error(`Invalid JSON from ${method} ${url.pathname}`);
            err.cause = error;
            err.body = body?.slice?.(0, 2000) || body;
            reject(err);
          }
        });
      }
    );

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timeout after ${timeoutMs}ms`));
    });
    req.end();
  });
}

module.exports = { requestJson };

