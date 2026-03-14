/**
 * WhisperService - Local speech-to-text using Whisper
 *
 * Supports:
 * 1. whisper.cpp (fastest, GPU accelerated)
 * 2. openai-whisper Python package (fallback)
 *
 * Models (speed vs accuracy tradeoff):
 * - tiny:  ~1s, 75MB,  good for commands
 * - base:  ~2s, 150MB, better accuracy
 * - small: ~4s, 500MB, much better
 */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { augmentProcessEnv, getHiddenProcessOptions } = require('./utils/processUtils');

class WhisperService {
  constructor() {
    this.backend = null; // 'whisper.cpp' | 'openai-whisper' | null
    this.model = process.env.WHISPER_MODEL || 'base';
    this.whisperCppPath = process.env.WHISPER_CPP_PATH || null;
    this.modelPath = process.env.WHISPER_MODEL_PATH || null;
    this.useGpu = process.env.WHISPER_GPU !== 'false';

    this.checkAvailability();
  }

  commandExists(cmd) {
    const name = String(cmd || '').trim();
    if (!name) return false;
    try {
      if (process.platform === 'win32') {
        const res = spawnSync('where.exe', [name], { stdio: 'ignore', windowsHide: true });
        return res.status === 0;
      }
      const res = spawnSync('which', [name], { stdio: 'ignore' });
      return res.status === 0;
    } catch {
      return false;
    }
  }

  pythonCommandCandidates() {
    return process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];
  }

  /**
   * Check which Whisper backend is available
   */
  checkAvailability() {
    // Check for whisper.cpp first (faster)
    if (this.whisperCppPath && fs.existsSync(this.whisperCppPath)) {
      this.backend = 'whisper.cpp';
      console.log('[Whisper] Using whisper.cpp at:', this.whisperCppPath);
      return;
    }

    // Try to find whisper.cpp in common locations
    const commonPaths = [
      '/usr/local/bin/whisper',
      path.join(os.homedir(), 'whisper.cpp/main'),
      path.join(os.homedir(), 'whisper.cpp/build/bin/main'),
      path.join(os.homedir(), '.local/bin/whisper'),
    ];

    for (const p of commonPaths) {
      if (fs.existsSync(p)) {
        this.whisperCppPath = p;
        this.backend = 'whisper.cpp';
        console.log('[Whisper] Found whisper.cpp at:', p);
        return;
      }
    }

    // Check for openai-whisper Python package
    try {
      if (!this.commandExists('whisper')) throw new Error('whisper not found');
      this.backend = 'openai-whisper';
      console.log('[Whisper] Using openai-whisper (Python)');
      return;
    } catch (e) {
      // Not found
    }

    // Check for faster-whisper
    for (const py of this.pythonCommandCandidates()) {
      try {
        const res = spawnSync(py, ['-c', 'import faster_whisper'], { stdio: 'ignore', windowsHide: true });
        if (res.status === 0) {
          this.backend = 'faster-whisper';
          console.log('[Whisper] Using faster-whisper (Python, GPU optimized)');
          return;
        }
      } catch {
        // ignore
      }
    }

    console.log('[Whisper] No Whisper backend available. Install whisper.cpp or openai-whisper.');
    this.backend = null;
  }

  /**
   * Check if Whisper is available
   */
  isAvailable() {
    return this.backend !== null;
  }

  /**
   * Get status info
   */
  getStatus() {
    return {
      available: this.isAvailable(),
      backend: this.backend,
      model: this.model,
      gpu: this.useGpu,
      whisperCppPath: this.whisperCppPath
    };
  }

  /**
   * Transcribe audio file
   * @param {string} audioPath - Path to audio file (wav, mp3, webm, etc.)
   * @returns {Promise<{text: string, duration: number}>}
   */
  async transcribe(audioPath) {
    if (!this.isAvailable()) {
      throw new Error('Whisper not available');
    }

    const startTime = Date.now();

    let text;
    switch (this.backend) {
      case 'whisper.cpp':
        text = await this.transcribeWithWhisperCpp(audioPath);
        break;
      case 'openai-whisper':
        text = await this.transcribeWithOpenAIWhisper(audioPath);
        break;
      case 'faster-whisper':
        text = await this.transcribeWithFasterWhisper(audioPath);
        break;
      default:
        throw new Error(`Unknown backend: ${this.backend}`);
    }

    const duration = Date.now() - startTime;
    console.log(`[Whisper] Transcribed in ${duration}ms: "${text}"`);

    return { text, duration };
  }

  /**
   * Transcribe using whisper.cpp
   */
  async transcribeWithWhisperCpp(audioPath) {
    return new Promise((resolve, reject) => {
      // whisper.cpp needs WAV format, convert if needed
      const wavPath = audioPath.endsWith('.wav') ? audioPath : `${audioPath}.wav`;

      // Convert to WAV if needed (16kHz mono for whisper)
      if (!audioPath.endsWith('.wav')) {
        try {
          const res = spawnSync('ffmpeg', ['-y', '-i', audioPath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavPath], {
            stdio: 'ignore',
            windowsHide: true
          });
          if (res.status !== 0) {
            throw new Error(`ffmpeg exit ${res.status}`);
          }
        } catch (e) {
          return reject(new Error('Failed to convert audio to WAV. Install ffmpeg.'));
        }
      }

      // Find model path
      const modelPath = this.modelPath || this.findModelPath();
      if (!modelPath) {
        return reject(new Error(`Whisper model '${this.model}' not found`));
      }

      const args = [
        '-m', modelPath,
        '-f', wavPath,
        '--no-timestamps',
        '-l', 'en',
      ];

      // Add GPU flag if available
      if (this.useGpu) {
        args.push('--gpu');
      }

      const proc = spawn(this.whisperCppPath, args, getHiddenProcessOptions({
        env: augmentProcessEnv(process.env)
      }));
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data; });
      proc.stderr.on('data', (data) => { stderr += data; });

      proc.on('close', (code) => {
        // Clean up temp WAV
        if (wavPath !== audioPath && fs.existsSync(wavPath)) {
          fs.unlinkSync(wavPath);
        }

        if (code !== 0) {
          return reject(new Error(`whisper.cpp failed: ${stderr}`));
        }

        // Parse output - whisper.cpp outputs text with timing info
        const text = stdout
          .split('\n')
          .filter(line => !line.startsWith('[') && line.trim())
          .join(' ')
          .trim();

        resolve(text);
      });
    });
  }

  /**
   * Find whisper.cpp model file
   */
  findModelPath() {
    const modelName = `ggml-${this.model}.bin`;
    const searchPaths = [
      path.join(os.homedir(), 'whisper.cpp/models', modelName),
      path.join(os.homedir(), '.cache/whisper', modelName),
      `/usr/local/share/whisper/${modelName}`,
      path.join(os.homedir(), `.local/share/whisper/${modelName}`),
    ];

    for (const p of searchPaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
    return null;
  }

  /**
   * Transcribe using openai-whisper Python package
   */
  async transcribeWithOpenAIWhisper(audioPath) {
    return new Promise((resolve, reject) => {
      const tmpDir = os.tmpdir();
      const proc = spawn('whisper', [
        audioPath,
        '--model', this.model,
        '--language', 'en',
        '--output_format', 'txt',
        '--output_dir', tmpDir,
      ], getHiddenProcessOptions({
        env: augmentProcessEnv(process.env)
      }));

      let stderr = '';
      proc.stderr.on('data', (data) => { stderr += data; });

      proc.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(`whisper failed: ${stderr}`));
        }

        // Read output file
        const baseName = path.basename(audioPath, path.extname(audioPath));
        const outputPath = path.join(tmpDir, `${baseName}.txt`);

        if (fs.existsSync(outputPath)) {
          const text = fs.readFileSync(outputPath, 'utf-8').trim();
          fs.unlinkSync(outputPath);
          resolve(text);
        } else {
          reject(new Error('Whisper output file not found'));
        }
      });
    });
  }

  /**
   * Transcribe using faster-whisper (GPU optimized)
   */
  async transcribeWithFasterWhisper(audioPath) {
    return new Promise((resolve, reject) => {
      const script = `
import sys
from faster_whisper import WhisperModel
model = WhisperModel("${this.model}", device="${this.useGpu ? 'cuda' : 'cpu'}", compute_type="float16" if "${this.useGpu}" == "true" else "int8")
segments, info = model.transcribe("${audioPath}", language="en")
print(" ".join([s.text for s in segments]).strip())
`;

      const pythonCmd = this.pythonCommandCandidates().find((c) => this.commandExists(c)) || (process.platform === 'win32' ? 'python' : 'python3');
      const proc = spawn(pythonCmd, ['-c', script], getHiddenProcessOptions({
        env: augmentProcessEnv(process.env)
      }));
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data; });
      proc.stderr.on('data', (data) => { stderr += data; });

      proc.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(`faster-whisper failed: ${stderr}`));
        }
        resolve(stdout.trim());
      });
    });
  }
}

// Singleton
const whisperService = new WhisperService();
module.exports = whisperService;
