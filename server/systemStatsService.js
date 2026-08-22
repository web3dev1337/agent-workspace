const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/system-stats.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

// CPU% is sampled on a rolling timer (os.cpus() has no "since last call"
// delta of its own), so requests just read the latest computed value instead
// of blocking on two live reads.
const CPU_SAMPLE_INTERVAL_MS = 2000;
// nvidia-smi is fast (local driver query), so a short cache is enough to
// dedupe bursty header/modal polling without going stale.
const GPU_CACHE_TTL_MS = 3000;
const NVIDIA_SMI_TIMEOUT_MS = 5000;
// The WSL2 per-process breakdown shells out to Windows PowerShell, which is
// slow (~1-3s) — cache longer and dedupe in-flight calls so the modal doesn't
// pay that cost on every poll.
const GPU_PROCESSES_CACHE_TTL_MS = 12000;
const GPU_PROCESSES_TIMEOUT_MS = 20000;

function round1(n) {
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

// llama.cpp's server binary takes -m/--model <path>; extract it so "what's
// using the VRAM" can name the actual model instead of just the binary.
function extractModelPath(argv) {
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '-m' || argv[i] === '--model') && argv[i + 1]) return argv[i + 1];
  }
  return null;
}

function extractFlagValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}

function basenameNoExt(p) {
  const base = String(p || '').split('/').pop() || '';
  return base.replace(/\.(gguf|bin)$/i, '');
}

// Best-effort identity for a locally-running (WSL-side) GPU process from its
// argv — this is what lets the VRAM breakdown say "Qwen3.8-27B (llama.cpp)"
// instead of just "python" or an opaque PID.
function describeLocalProcess(argv) {
  const binary = argv[0] || '';
  const isLlamaCpp = /llama-server|llama\.cpp/i.test(binary) || argv.some(a => /llama-server/i.test(a));
  if (isLlamaCpp) {
    const modelPath = extractModelPath(argv);
    return {
      kind: 'llama.cpp',
      label: modelPath ? basenameNoExt(modelPath) : 'llama.cpp server',
      modelPath,
      port: extractFlagValue(argv, '--port')
    };
  }
  if (/\bollama\b/i.test(binary)) {
    return { kind: 'ollama-runner', label: 'Ollama runner', modelPath: null, port: null };
  }
  return { kind: 'other', label: binary.split('/').pop() || 'unknown process', modelPath: null, port: null };
}

class SystemStatsService {
  constructor() {
    this.isWSL = process.platform === 'linux' && !!(process.env.WSL_DISTRO_NAME || process.env.WSLENV);
    this.cpuPercent = null;
    this._prevCpuTimes = this._readCpuTimes();
    this._cpuTimer = setInterval(() => this._sampleCpu(), CPU_SAMPLE_INTERVAL_MS);
    this._cpuTimer.unref?.();
    this.gpuCache = null; // { at, data }
    this.gpuInFlight = null;
    this.gpuProcessesCache = null; // { at, data }
    this.gpuProcessesInFlight = null;
    this.modelsCache = null; // { at, data }
    this.modelsInFlight = null;
  }

  static getInstance() {
    if (!SystemStatsService.instance) {
      SystemStatsService.instance = new SystemStatsService();
    }
    return SystemStatsService.instance;
  }

  _readCpuTimes() {
    let idle = 0;
    let total = 0;
    for (const cpu of os.cpus()) {
      for (const key of Object.keys(cpu.times)) total += cpu.times[key];
      idle += cpu.times.idle;
    }
    return { idle, total };
  }

  _sampleCpu() {
    const curr = this._readCpuTimes();
    const prev = this._prevCpuTimes;
    this._prevCpuTimes = curr;
    const totalDelta = curr.total - prev.total;
    if (totalDelta <= 0) return;
    this.cpuPercent = Math.round((1 - (curr.idle - prev.idle) / totalDelta) * 100);
  }

  getRam() {
    try {
      // /proc/meminfo (Linux + WSL2): MemAvailable already accounts for
      // reclaimable page cache the way `free`'s "available" column does —
      // a naive total-minus-free would count cache as "used" and read high.
      const raw = fs.readFileSync('/proc/meminfo', 'utf8');
      const grabKB = (key) => {
        const m = raw.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'));
        return m ? Number(m[1]) * 1024 : null;
      };
      const totalBytes = grabKB('MemTotal');
      const availableBytes = grabKB('MemAvailable');
      if (totalBytes && availableBytes !== null) {
        const usedBytes = totalBytes - availableBytes;
        return {
          totalGB: round1(totalBytes / 1e9),
          usedGB: round1(usedBytes / 1e9),
          percent: Math.round((usedBytes / totalBytes) * 100)
        };
      }
    } catch {
      // /proc/meminfo missing (non-Linux) — fall through to the os.* fallback.
    }
    const totalBytes = os.totalmem();
    const usedBytes = totalBytes - os.freemem();
    return {
      totalGB: round1(totalBytes / 1e9),
      usedGB: round1(usedBytes / 1e9),
      percent: Math.round((usedBytes / totalBytes) * 100)
    };
  }

  _fetchGpuTotals() {
    return new Promise((resolve) => {
      execFile('nvidia-smi', [
        '--query-gpu=name,memory.total,memory.used,utilization.gpu',
        '--format=csv,noheader,nounits'
      ], { timeout: NVIDIA_SMI_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
        if (error) {
          resolve({ available: false, reason: error.code === 'ENOENT' ? 'not-installed' : String(error.message) });
          return;
        }
        const line = stdout.split('\n').map(l => l.trim()).find(Boolean);
        if (!line) {
          resolve({ available: false, reason: 'no-output' });
          return;
        }
        const [name, totalMiB, usedMiB, util] = line.split(',').map(s => s.trim());
        const total = Number(totalMiB);
        const used = Number(usedMiB);
        resolve({
          available: true,
          name,
          totalGB: round1(total / 1024),
          usedGB: round1(used / 1024),
          percent: total ? Math.round((used / total) * 100) : null,
          utilization: Number.isFinite(Number(util)) ? Number(util) : null
        });
      });
    });
  }

  async getGpu({ refresh = false } = {}) {
    if (!refresh && this.gpuCache && Date.now() - this.gpuCache.at < GPU_CACHE_TTL_MS) return this.gpuCache.data;
    if (this.gpuInFlight) return this.gpuInFlight;
    this.gpuInFlight = this._fetchGpuTotals().then((data) => {
      this.gpuCache = { at: Date.now(), data };
      return data;
    }).finally(() => { this.gpuInFlight = null; });
    return this.gpuInFlight;
  }

  // "What's using the VRAM" — best-effort per-process breakdown. WSL2's own
  // nvidia-smi can't resolve compute-app process name/memory for processes
  // running on the Windows host (reports "[Not Found]" / "[N/A]"), so under
  // WSL2 this shells out to Windows PowerShell's GPU performance counters,
  // which do resolve per-PID dedicated VRAM. Native Linux/Windows query
  // nvidia-smi directly, which resolves names fine outside WSL2.
  _fetchGpuProcesses() {
    return this.isWSL ? this._fetchGpuProcessesWindows() : this._fetchGpuProcessesNvidiaSmi();
  }

  _fetchGpuProcessesNvidiaSmi() {
    return new Promise((resolve) => {
      execFile('nvidia-smi', [
        '--query-compute-apps=pid,process_name,used_memory',
        '--format=csv,noheader,nounits'
      ], { timeout: NVIDIA_SMI_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
        if (error) {
          resolve({ available: false, reason: String(error.message) });
          return;
        }
        const processes = stdout.split('\n').map(l => l.trim()).filter(Boolean)
          .map((line) => {
            const [pid, name, usedMiB] = line.split(',').map(s => s.trim());
            return { pid: Number(pid), name, usedGB: round1(Number(usedMiB) / 1024) };
          })
          .filter(p => Number.isFinite(p.usedGB))
          .sort((a, b) => b.usedGB - a.usedGB);
        resolve({ available: true, processes, source: 'nvidia-smi' });
      });
    });
  }

  // WSL-native nvidia-smi CAN see WSL-side compute processes (unlike Windows
  // host processes), but --query-compute-apps can't resolve their name or
  // memory under WSL ("[Not Found]"/"[N/A]" even though the plain table
  // output resolves the name fine) — so this only uses it for the PID list,
  // then reads each one's real command line from /proc for identity.
  async _fetchLocalWslGpuProcesses() {
    const pids = await new Promise((resolve) => {
      execFile('nvidia-smi', [
        '--query-compute-apps=pid', '--format=csv,noheader'
      ], { timeout: NVIDIA_SMI_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
        if (error) { resolve([]); return; }
        resolve(stdout.split('\n').map(l => Number(l.trim())).filter(Number.isFinite));
      });
    });
    return pids.map((pid) => {
      try {
        const raw = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
        const argv = raw.split('\0').filter(Boolean);
        if (!argv.length) return null;
        return { pid, argv, ...describeLocalProcess(argv) };
      } catch {
        return null; // process gone, or /proc unreadable (permissions)
      }
    }).filter(Boolean);
  }

  // "vmwp" is the Hyper-V/WSL2 VM worker process — it's the umbrella PID
  // Windows attributes ALL of the WSL2 Linux VM's GPU usage to. Rather than
  // leave that as one opaque line, identify what's actually running inside
  // WSL and use its name — WSL doesn't expose a per-process memory split,
  // so with more than one candidate they share the one combined total.
  async _enrichWslBucket(processes) {
    const bucket = processes.find(p => p.name === 'WSL2 VM (Linux-side GPU usage)');
    if (!bucket) return processes;
    const local = await this._fetchLocalWslGpuProcesses();
    if (!local.length) return processes;
    const names = local.map(p => p.label).join(', ');
    bucket.name = local.length === 1
      ? `${local[0].label} (${local[0].kind})`
      : `${names} (${local.length} processes, combined)`;
    bucket.identified = local.map(p => ({ pid: p.pid, kind: p.kind, label: p.label, port: p.port }));
    return processes;
  }

  _fetchGpuProcessesWindows() {
    const script = [
      "$samples = (Get-Counter '\\GPU Process Memory(*)\\Dedicated Usage').CounterSamples | Where-Object {$_.CookedValue -gt 30MB}",
      '$rows = foreach ($s in $samples) {',
      "  if ($s.InstanceName -match 'pid_(\\d+)_') {",
      '    $procId = [int]$Matches[1]',
      "    $name = 'Unknown'",
      '    try { $name = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch {}',
      '    [PSCustomObject]@{ pid = $procId; name = $name; mb = [math]::Round($s.CookedValue/1MB,1) }',
      '  }',
      '}',
      '$rows | Sort-Object mb -Descending | Select-Object -First 20 | ConvertTo-Json -Compress'
    ].join('\n');
    return new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        timeout: GPU_PROCESSES_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024
      }, async (error, stdout) => {
        if (error) {
          logger.warn('GPU process breakdown (WSL->Windows) failed', { error: error.message });
          resolve({ available: false, reason: 'powershell-failed' });
          return;
        }
        let rows;
        try {
          const parsed = JSON.parse(stdout.trim() || '[]');
          rows = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
        } catch {
          resolve({ available: false, reason: 'parse-failed' });
          return;
        }
        let processes = rows.map(r => ({
          pid: r.pid,
          name: r.name === 'vmwp' ? 'WSL2 VM (Linux-side GPU usage)' : r.name,
          usedGB: round1(r.mb / 1024)
        }));
        try {
          processes = await this._enrichWslBucket(processes);
        } catch (enrichError) {
          logger.warn('WSL GPU bucket enrichment failed', { error: enrichError.message });
        }
        resolve({ available: true, processes, source: 'windows-gpu-counters' });
      });
    });
  }

  async getGpuProcesses({ refresh = false } = {}) {
    if (!refresh && this.gpuProcessesCache && Date.now() - this.gpuProcessesCache.at < GPU_PROCESSES_CACHE_TTL_MS) {
      return this.gpuProcessesCache.data;
    }
    if (this.gpuProcessesInFlight) return this.gpuProcessesInFlight;
    this.gpuProcessesInFlight = this._fetchGpuProcesses().then((data) => {
      this.gpuProcessesCache = { at: Date.now(), data };
      return data;
    }).finally(() => { this.gpuProcessesInFlight = null; });
    return this.gpuProcessesInFlight;
  }

  // "ollama ps" table: NAME  ID  SIZE  PROCESSOR  CONTEXT  UNTIL
  _fetchOllamaModels() {
    return new Promise((resolve) => {
      execFile('ollama', ['ps'], { timeout: NVIDIA_SMI_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
        if (error) {
          resolve({ available: error.code !== 'ENOENT', reason: error.code === 'ENOENT' ? 'not-installed' : String(error.message), models: [] });
          return;
        }
        const lines = stdout.split('\n').map(l => l.replace(/\r$/, '')).filter(Boolean);
        lines.shift(); // header row
        const models = lines.map((line) => {
          const cols = line.trim().split(/\s{2,}/);
          const [name, id, size, processor, context, until] = cols;
          if (!name) return null;
          return { source: 'ollama', name, id, size, processor, context, until };
        }).filter(Boolean);
        resolve({ available: true, models });
      });
    });
  }

  // Loaded-model inventory across both ways this machine runs local LLM
  // inference: Ollama-managed models (unloaded via the official `ollama
  // stop`) and standalone llama.cpp `llama-server` processes identified from
  // /proc (no clean "unload" API — freeing that VRAM means stopping the
  // process, so unload sends it SIGTERM after re-verifying its identity).
  async getLoadedModels({ refresh = false } = {}) {
    if (!refresh && this.modelsCache && Date.now() - this.modelsCache.at < GPU_PROCESSES_CACHE_TTL_MS) {
      return this.modelsCache.data;
    }
    if (this.modelsInFlight) return this.modelsInFlight;
    this.modelsInFlight = (async () => {
      const [ollama, local] = await Promise.all([
        this._fetchOllamaModels(),
        this._fetchLocalWslGpuProcesses().catch(() => [])
      ]);
      const llamaCppServers = local
        .filter(p => p.kind === 'llama.cpp')
        .map(p => ({ source: 'llama.cpp', name: p.label, modelPath: p.modelPath, port: p.port, pid: p.pid }));
      return { ollama, llamaCppServers };
    })().then((data) => {
      this.modelsCache = { at: Date.now(), data };
      return data;
    }).finally(() => { this.modelsInFlight = null; });
    return this.modelsInFlight;
  }

  async unloadModel({ source, name, pid } = {}) {
    if (source === 'ollama') {
      if (!name) return { ok: false, reason: 'missing-name' };
      return new Promise((resolve) => {
        execFile('ollama', ['stop', name], { timeout: NVIDIA_SMI_TIMEOUT_MS, windowsHide: true }, (error) => {
          resolve(error ? { ok: false, reason: String(error.message) } : { ok: true });
        });
      });
    }
    if (source === 'llama.cpp') {
      const numericPid = Number(pid);
      if (!Number.isInteger(numericPid) || numericPid <= 1) return { ok: false, reason: 'invalid-pid' };
      try {
        // Re-verify it's still the same llama.cpp process before killing —
        // the PID could have been reused by something else since it was
        // listed (never trust a stale PID for a destructive action).
        const raw = fs.readFileSync(`/proc/${numericPid}/cmdline`, 'utf8');
        const argv = raw.split('\0').filter(Boolean);
        if (describeLocalProcess(argv).kind !== 'llama.cpp') {
          return { ok: false, reason: 'pid-no-longer-llama-server' };
        }
        process.kill(numericPid, 'SIGTERM');
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: String(error.message) };
      }
    }
    return { ok: false, reason: 'unknown-source' };
  }

  async getStats({ includeProcesses = false, refresh = false } = {}) {
    const [gpu, gpuProcesses, models] = await Promise.all([
      this.getGpu({ refresh }),
      includeProcesses ? this.getGpuProcesses({ refresh }) : Promise.resolve(null),
      includeProcesses ? this.getLoadedModels({ refresh }) : Promise.resolve(null)
    ]);
    return {
      cpu: { percent: this.cpuPercent, cores: os.cpus().length },
      ram: this.getRam(),
      gpu,
      gpuProcesses,
      models,
      updatedAt: Date.now()
    };
  }
}

module.exports = { SystemStatsService };
