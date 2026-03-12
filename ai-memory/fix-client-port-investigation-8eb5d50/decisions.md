# Decisions

## Root Cause
`http-proxy-middleware` v3.0.5 changed the API. When using `app.use('/api', createProxyMiddleware({...}))`, Express strips the mount prefix from `req.url`, so `/api/workspaces` gets forwarded as `/workspaces` to the backend.

## Fix
Use `pathFilter` option in createProxyMiddleware instead of Express mount paths. This keeps the full path intact when forwarding.

## Routes added to proxy
- `/socket.io` (was broken - polling returned index.html)
- `/api` (was broken - most routes 404'd, some accidentally worked)
- `/bootstrap` (was not proxied at all - setup-state.js returned index.html)
- `/health` (was not proxied - returned index.html)
- `/replay-viewer` (was not proxied - returned index.html)
