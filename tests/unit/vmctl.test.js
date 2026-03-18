const { EventEmitter } = require('events');

describe('vmctl', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.dontMock('child_process');
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: originalPlatform
    });
  });

  test('encodes PowerShell commands in UTF-16LE', () => {
    const { encodePowerShellCommand } = require('../../scripts/vm/vmctl');
    expect(encodePowerShellCommand('Write-Output hello')).toBe(
      Buffer.from('Write-Output hello', 'utf16le').toString('base64')
    );
  });

  test('builds a PowerShell script with cwd and env prelude', () => {
    const { buildRemoteCommandScript } = require('../../scripts/vm/vmctl');
    const script = buildRemoteCommandScript('Get-Location', {
      cwd: 'C:\\Users\\Tester',
      env: {
        FOO: 'bar',
        BAZ: 'two words'
      }
    });

    expect(script).toContain('$ErrorActionPreference = \'Stop\'');
    expect(script).toContain('[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)');
    expect(script).toContain('Set-Location -LiteralPath \'C:\\Users\\Tester\'');
    expect(script).toContain('$env:FOO = \'bar\'');
    expect(script).toContain('$env:BAZ = \'two words\'');
    expect(script).toContain('try {');
    expect(script).toContain('Get-Location');
  });

  test('runRemotePowerShell uses ssh with encoded PowerShell and hides windows on Windows', async () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'win32'
    });

    const spawn = jest.fn();
    jest.doMock('child_process', () => ({ spawn }));

    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = jest.fn();
    spawn.mockReturnValue(child);

    const { runRemotePowerShell, encodePowerShellCommand } = require('../../scripts/vm/vmctl');
    const promise = runRemotePowerShell({
      host: 'vmwin',
      remoteExe: 'powershell.exe',
      command: 'Write-Output hello',
      stream: false
    });

    const expectedScript = [
      '$ErrorActionPreference = \'Stop\'',
      '$ProgressPreference = \'SilentlyContinue\'',
      '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)',
      '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
      '$OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
      'try {',
      'Write-Output hello',
      '} catch {',
      '  Write-Error $_',
      '  exit 1',
      '}',
      'if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }'
    ].join('\n');

    expect(spawn).toHaveBeenCalledWith(
      expect.stringContaining('ssh'),
      [
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=10',
        '-o',
        'ServerAliveInterval=5',
        '-o',
        'ServerAliveCountMax=2',
        'vmwin',
        'powershell.exe',
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        encodePowerShellCommand(expectedScript)
      ],
      expect.objectContaining({
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        creationFlags: 0x08000000
      })
    );

    child.stdout.emit('data', Buffer.from('hello\n'));
    child.emit('close', 0);

    await expect(promise).resolves.toEqual(
      expect.objectContaining({
        code: 0,
        stdout: 'hello\n'
      })
    );
  });

  test('formatStatusSummary keeps the summary concise', () => {
    const { formatStatusSummary } = require('../../scripts/vm/vmctl');

    const summary = formatStatusSummary({
      host: 'vmwin',
      remoteExe: 'powershell.exe',
      status: {
        hostName: 'VM',
        userName: 'administrator',
        domainName: 'WORKGROUP',
        psVersion: '5.1.22621.2506',
        psEdition: 'Desktop',
        osVersion: 'Microsoft Windows [Version 10.0.22621.2506]',
        cwd: 'C:\\Users\\administrator',
        home: 'C:\\Users\\administrator',
        tools: {
          git: true,
          node: true,
          npm: true
        }
      }
    });

    expect(summary).toContain('vmwin | powershell.exe');
    expect(summary).toContain('host VM');
    expect(summary).toContain('user administrator');
    expect(summary).toContain('tools: git=yes, node=yes, npm=yes');
  });
});
