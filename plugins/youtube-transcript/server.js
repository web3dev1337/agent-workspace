'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const YT_URL_RE = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|m\.youtube\.com)\//i;
const EXEC_TIMEOUT_MS = 180_000;

const run = (cmd, args, options = {}) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: EXEC_TIMEOUT_MS, maxBuffer: 20_000_000, ...options }, (error, stdout, stderr) => {
    if (error) {
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    } else {
      resolve({ stdout, stderr });
    }
  });
});

const hasYtDlp = async () => {
  try {
    await run('yt-dlp', ['--version']);
    return true;
  } catch {
    return false;
  }
};

// VTT → plain text: drop headers/timestamps/cue settings/inline tags and the
// duplicated rolling lines that auto-generated captions produce.
const vttToText = (vtt) => {
  const lines = String(vtt || '').split(/\r?\n/);
  const out = [];
  let last = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^WEBVTT/i.test(line) || /^Kind:|^Language:/i.test(line)) continue;
    if (/-->/.test(line)) continue;
    if (/^\d+$/.test(line)) continue;
    const text = line.replace(/<[^>]+>/g, '').trim();
    if (!text || text === last) continue;
    out.push(text);
    last = text;
  }
  return out.join('\n');
};

const transcriptsDir = () => path.join(os.homedir(), 'Downloads', 'transcripts');

const transcribe = async (url, logger) => {
  const target = String(url || '').trim();
  if (!YT_URL_RE.test(target)) {
    return { ok: false, error: 'Not a YouTube URL. Expected youtube.com or youtu.be.' };
  }

  if (!(await hasYtDlp())) {
    return {
      ok: false,
      error: 'yt-dlp is not installed. Install it (e.g. `pipx install yt-dlp` or `sudo apt-get install -y yt-dlp`) and retry.',
      missingTool: 'yt-dlp'
    };
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-transcript-'));
  try {
    await run('yt-dlp', [
      '--skip-download',
      '--write-subs',
      '--write-auto-subs',
      '--sub-langs', 'en.*,en',
      '--sub-format', 'vtt',
      '--restrict-filenames',
      '-o', path.join(workDir, '%(title)s.%(ext)s'),
      target
    ]);

    const vttFile = fs.readdirSync(workDir).find(f => f.endsWith('.vtt'));
    if (!vttFile) {
      return { ok: false, error: 'No subtitles available for this video (not even auto-generated).' };
    }

    const text = vttToText(fs.readFileSync(path.join(workDir, vttFile), 'utf8'));
    if (!text.trim()) {
      return { ok: false, error: 'Subtitle file was empty after cleanup.' };
    }

    const title = vttFile.replace(/\.[a-z-]+\.vtt$/i, '').replace(/\.vtt$/i, '');
    const outDir = transcriptsDir();
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `${title}.txt`);
    fs.writeFileSync(outFile, `# ${title}\n# ${target}\n\n${text}\n`);

    logger?.info?.('Transcript saved', { outFile, chars: text.length });
    return {
      ok: true,
      file: outFile,
      title,
      chars: text.length,
      preview: text.slice(0, 400)
    };
  } catch (e) {
    const detail = String(e?.stderr || e?.message || e).slice(0, 500);
    return { ok: false, error: `yt-dlp failed: ${detail}` };
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* temp cleanup best-effort */ }
  }
};

module.exports = async function register({ router, registerCommand, logger }) {
  router.post('/transcribe', async (req, res) => {
    const result = await transcribe(req.body?.url, logger);
    res.status(result.ok ? 200 : 400).json({
      ...result,
      message: result.ok
        ? `Transcript saved: ${result.file} (${result.chars} chars)`
        : result.error
    });
  });

  registerCommand('transcribe', {
    category: 'plugin',
    description: 'Fetch a YouTube transcript to ~/Downloads/transcripts (yt-dlp subtitles)',
    params: [{ name: 'url', description: 'YouTube video URL', required: true }],
    examples: ['transcribe https://www.youtube.com/watch?v=...'],
    handler: async (params = {}) => {
      const result = await transcribe(params.url, logger);
      if (!result.ok) throw new Error(result.error);
      return { message: `Transcript saved: ${result.file} (${result.chars} chars)` };
    }
  });
};
