const {
  MAX_SERVICES,
  normalizeServiceManifest,
  getWorkspaceServiceManifest,
  mergeServiceManifests
} = require('../../server/workspaceServiceStackService');

describe('workspaceServiceStackService', () => {
  test('normalizes valid service stack manifest', () => {
    const manifest = normalizeServiceManifest({
      services: [
        {
          id: 'api',
          name: 'API server',
          command: 'npm run dev',
          cwd: '/repo',
          restartPolicy: 'on-failure',
          enabled: true,
          env: {
            NODE_ENV: 'development',
            PORT: 9460
          },
          healthcheck: {
            type: 'http',
            url: 'http://127.0.0.1:9460/health',
            intervalSeconds: 12
          }
        },
        {
          name: 'Worker',
          command: 'npm run worker',
          order: 1
        }
      ]
    });

    expect(manifest.manifestVersion).toBe(1);
    expect(manifest.services).toHaveLength(2);
    expect(manifest.services[0].name).toBe('API server');
    expect(manifest.services[0].id).toBe('api');
    expect(manifest.services[1].id).toBe('worker');
    expect(manifest.services[0].env).toEqual({
      NODE_ENV: 'development',
      PORT: '9460'
    });
    expect(manifest.services[0].healthcheck).toEqual({
      type: 'http',
      url: 'http://127.0.0.1:9460/health',
      intervalSeconds: 12
    });
  });

  test('throws on invalid service stack manifest in strict mode', () => {
    expect(() => normalizeServiceManifest({
      services: [
        {
          name: 'Broken',
          command: 'echo hi',
          restartPolicy: 'sometimes'
        }
      ]
    }, { strict: true })).toThrow('invalid restartPolicy');

    expect(() => normalizeServiceManifest({
      services: [
        {
          name: 'Bad health',
          command: 'echo hi',
          healthcheck: {
            type: 'http',
            url: 'not-a-url'
          }
        }
      ]
    }, { strict: true })).toThrow('valid http(s) url');
  });

  test('non-strict mode drops invalid services and enforces max', () => {
    const tooMany = [];
    for (let i = 0; i < MAX_SERVICES + 5; i += 1) {
      tooMany.push({
        name: `svc-${i}`,
        command: 'echo ok',
        order: i
      });
    }
    tooMany.push({
      name: 'bad',
      command: 'echo bad',
      restartPolicy: 'unknown'
    });
    const manifest = normalizeServiceManifest({ services: tooMany }, { strict: false });
    expect(manifest.services).toHaveLength(MAX_SERVICES);
  });

  test('reads workspace service stack from serviceStack or services key', () => {
    const workspaceFromServiceStack = {
      serviceStack: {
        services: [{ name: 'A', command: 'echo a' }]
      }
    };
    const workspaceFromServices = {
      services: {
        services: [{ name: 'B', command: 'echo b' }]
      }
    };
    const stackA = getWorkspaceServiceManifest(workspaceFromServiceStack);
    const stackB = getWorkspaceServiceManifest(workspaceFromServices);
    expect(stackA.services).toHaveLength(1);
    expect(stackB.services).toHaveLength(1);
    expect(stackA.services[0].name).toBe('A');
    expect(stackB.services[0].name).toBe('B');
  });

  test('merges shared baseline with local override by service id', () => {
    const merged = mergeServiceManifests(
      {
        services: [
          { id: 'api', name: 'API', command: 'npm run dev', order: 1 }
        ]
      },
      {
        services: [
          { id: 'api', name: 'API', command: 'npm run dev:local', order: 1 },
          { id: 'worker', name: 'Worker', command: 'npm run worker', order: 2 }
        ]
      }
    );

    expect(merged.services).toHaveLength(2);
    expect(merged.services.find((item) => item.id === 'api')?.command).toBe('npm run dev:local');
    expect(merged.services.find((item) => item.id === 'worker')?.command).toBe('npm run worker');
  });
});
