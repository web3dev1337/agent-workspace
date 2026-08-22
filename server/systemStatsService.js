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

  // "vmwp" is the Hyper-V/WSL2 VM worker process — it's the umbrella PID
  // Windows attributes ALL of the WSL2 Linux VM's GPU usage to, so anything
  // running inside WSL (this orchestrator included) shows up under that one
  // name rather than broken out further.
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
      }, (error, stdout) => {
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
        const processes = rows.map(r => ({
          pid: r.pid,
          name: r.name === 'vmwp' ? 'WSL2 VM (Linux-side GPU usage)' : r.name,
          usedGB: round1(r.mb / 1024)
        }));
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

  async getStats({ includeProcesses = false, refresh = false } = {}) {
    const [gpu, gpuProcesses] = await Promise.all([
      this.getGpu({ refresh }),
      includeProcesses ? this.getGpuProcesses({ refresh }) : Promise.resolve(null)
    ]);
    return {
      cpu: { percent: this.cpuPercent, cores: os.cpus().length },
      ram: this.getRam(),
      gpu,
      gpuProcesses,
      updatedAt: Date.now()
    };
  }
}

module.exports = { SystemStatsService };
