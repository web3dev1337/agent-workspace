/**
 * VoiceControl - Push-to-talk voice command interface
 *
 * Transcription backends:
 * 1. Google Web Speech API (default) - fast, external
 * 2. Whisper (local) - private, GPU accelerated
 *
 * LLM backends for command parsing:
 * 1. Rule-based (instant)
 * 2. Ollama (local)
 * 3. Claude API (external fallback)
 */

class VoiceControl {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.recognition = null;
    this.isListening = false;
    this.button = null;
    this.statusEl = null;
    this.transcriptEl = null;

    // Transcription backend: 'google' | 'whisper'
    this.transcriptionBackend = 'google';
    try {
      this.transcriptionBackend = localStorage.getItem('voiceTranscriptionBackend') || 'google';
    } catch {
      // Storage access can be blocked in some WebView/Tracking Prevention modes.
      this.transcriptionBackend = 'google';
    }

    // Audio recording for Whisper
    this.mediaRecorder = null;
    this.audioChunks = [];

    // Backend status
    this.whisperAvailable = false;
    this.commandList = [];

    this.init();
  }

  init() {
    // Check for Web Speech API support (for Google backend)
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = false;
      this.recognition.interimResults = true;
      this.recognition.lang = 'en-US';

      this.recognition.onstart = () => this.onStart();
      this.recognition.onend = () => this.onEnd();
      this.recognition.onresult = (e) => this.onResult(e);
      this.recognition.onerror = (e) => this.onError(e);
    } else {
      console.warn('Web Speech API not supported - will try Whisper');
    }

    this.createUI();
    this.setupKeyboardShortcut();
    this.checkBackendStatus();
  }

  /**
   * Check which backends are available
   */
  async checkBackendStatus() {
    try {
      // Check Whisper availability
      const whisperRes = await fetch('/api/whisper/status');
      const whisperStatus = await whisperRes.json().catch(() => ({}));
      this.whisperAvailable = whisperRes.ok && whisperStatus.available === true;

      // Check LLM status
      const llmRes = await fetch('/api/voice/status');
      const llmStatus = await llmRes.json().catch(() => ({}));

      console.log('[Voice] Backends:', {
        transcription: {
          google: !!this.recognition,
          whisper: this.whisperAvailable,
          active: this.transcriptionBackend
        },
        parsing: llmStatus
      });

      // If using Whisper but not available, fall back to Google
      if (this.transcriptionBackend === 'whisper' && !this.whisperAvailable) {
        console.warn('[Voice] Whisper not available, falling back to Google');
        this.transcriptionBackend = 'google';
      }

      // If no Google and Whisper available, switch to Whisper
      if (!this.recognition && this.whisperAvailable) {
        this.transcriptionBackend = 'whisper';
      }

      this.updateButtonTooltip();
    } catch (err) {
      console.error('[Voice] Failed to check backend status:', err);
    }
  }

  /**
   * Set transcription backend
   */
  setTranscriptionBackend(backend) {
    if (backend === 'whisper' && !this.whisperAvailable) {
      console.error('[Voice] Whisper not available');
      return false;
    }
    if (backend === 'google' && !this.recognition) {
      console.error('[Voice] Web Speech API not available');
      return false;
    }
    this.transcriptionBackend = backend;
    try {
      localStorage.setItem('voiceTranscriptionBackend', backend);
    } catch {
      // ignore
    }
    this.updateButtonTooltip();
    return true;
  }

  /**
   * Update voice command context with current workspace/worktree info
   * This helps the LLM understand commands like "focus on zoo game work 1"
   */
  async updateContext(contextData) {
    try {
      const response = await fetch('/api/voice/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: contextData })
      });
      if (response.ok) {
        console.log('[Voice] Context updated:', contextData);
      }
    } catch (err) {
      console.error('[Voice] Failed to update context:', err);
    }
  }

  createUI() {
    // Create voice control container
    const container = document.createElement('div');
    container.id = 'voice-control';
    container.className = 'voice-control';
    container.dataset.uiVisibility = 'header.voice';
    container.innerHTML = `
      <button id="voice-btn" class="voice-btn" title="Loading voice commands...">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
          <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
        </svg>
      </button>
      <div id="voice-status" class="voice-status"></div>
      <div id="voice-transcript" class="voice-transcript"></div>
    `;

    // Add to header
    const header = document.querySelector('.header-actions') || document.querySelector('header');
    if (header) {
      header.appendChild(container);
    } else {
      document.body.appendChild(container);
    }

    this.button = document.getElementById('voice-btn');
    this.statusEl = document.getElementById('voice-status');
    this.transcriptEl = document.getElementById('voice-transcript');

    // Fetch commands for tooltip dynamically
    this.loadCommandsTooltip();

    // Mouse events for push-to-talk
    this.button.addEventListener('mousedown', () => this.startListening());
    this.button.addEventListener('mouseup', () => this.stopListening());
    this.button.addEventListener('mouseleave', () => {
      if (this.isListening) this.stopListening();
    });

    // Touch events for mobile
    this.button.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.startListening();
    });
    this.button.addEventListener('touchend', (e) => {
      e.preventDefault();
      this.stopListening();
    });

    // Right-click for backend selection
    this.button.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showBackendMenu(e);
    });
  }

  showBackendMenu(event) {
    // Remove any existing menu
    const existing = document.getElementById('voice-backend-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.id = 'voice-backend-menu';
    menu.className = 'voice-backend-menu';
    menu.innerHTML = `
      <div class="menu-title">Transcription Backend</div>
      <div class="menu-item ${this.transcriptionBackend === 'google' ? 'active' : ''}" data-backend="google">
        <span class="check">${this.transcriptionBackend === 'google' ? '✓' : ''}</span>
        Google (fast, external)
      </div>
      <div class="menu-item ${this.transcriptionBackend === 'whisper' ? 'active' : ''} ${!this.whisperAvailable ? 'disabled' : ''}" data-backend="whisper">
        <span class="check">${this.transcriptionBackend === 'whisper' ? '✓' : ''}</span>
        Whisper (local, private)
        ${!this.whisperAvailable ? '<span class="unavailable">(not installed)</span>' : ''}
      </div>
    `;

    // Position near button
    menu.style.cssText = `
      position: fixed;
      top: ${event.clientY}px;
      left: ${event.clientX}px;
      background: var(--bg-secondary, #2d2d2d);
      border: 1px solid var(--border-color, #444);
      border-radius: 6px;
      padding: 8px 0;
      min-width: 200px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 10000;
    `;

    document.body.appendChild(menu);

    // Handle clicks
    menu.querySelectorAll('.menu-item:not(.disabled)').forEach(item => {
      item.addEventListener('click', () => {
        const backend = item.dataset.backend;
        this.setTranscriptionBackend(backend);
        menu.remove();
      });
    });

    // Close on click outside
    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  async loadCommandsTooltip() {
    try {
      const response = await fetch('/api/voice/commands');
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const commands = Array.isArray(payload)
        ? payload
        : (Array.isArray(payload?.commands) ? payload.commands : []);
      this.commandList = commands;
      this.updateButtonTooltip();
    } catch (err) {
      this.button.title = 'Voice Commands (hold or press V)';
    }
  }

  updateButtonTooltip() {
    const backendLabel = this.transcriptionBackend === 'whisper' ? '[Whisper/Local]' : '[Google]';
    let tooltip = `Voice Commands ${backendLabel} (hold V):\n`;
    if (Array.isArray(this.commandList) && this.commandList.length) {
      tooltip += this.commandList
        .map((c) => String(c?.command || '').trim())
        .filter(Boolean)
        .map((command) => '• ' + command.replace(/-/g, ' '))
        .join('\n');
    }
    tooltip += '\n\nRight-click to switch backend';
    if (this.button) {
      this.button.title = tooltip;
    }
  }

  setupKeyboardShortcut() {
    // V key for push-to-talk
    document.addEventListener('keydown', (e) => {
      // Do not steal common shortcuts like Ctrl/Cmd+V.
      if (e.key === 'v' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !this.isInputFocused()) {
        e.preventDefault();
        this.startListening();
      }
    });

    document.addEventListener('keyup', (e) => {
      if (e.key === 'v' && !e.ctrlKey && !e.metaKey && !e.altKey && !this.isInputFocused()) {
        e.preventDefault();
        this.stopListening();
      }
    });
  }

  isInputFocused() {
    const active = document.activeElement;
    return active && (
      active.tagName === 'INPUT' ||
      active.tagName === 'TEXTAREA' ||
      active.isContentEditable
    );
  }

  startListening() {
    if (this.isListening) return;

    if (this.transcriptionBackend === 'whisper') {
      this.startWhisperRecording();
    } else {
      this.startGoogleRecognition();
    }
  }

  startGoogleRecognition() {
    if (!this.recognition) {
      this.setStatus('Google Speech not available', 'error');
      return;
    }

    try {
      this.recognition.start();
      this.isListening = true;
      this.button.classList.add('listening');
      this.setStatus('Listening...', 'listening');
      this.transcriptEl.textContent = '';
    } catch (err) {
      console.error('Failed to start recognition:', err);
    }
  }

  async startWhisperRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      });
      this.audioChunks = [];

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          this.audioChunks.push(e.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
        // Process the recording
        this.processWhisperRecording();
      };

      this.mediaRecorder.start();
      this.isListening = true;
      this.button.classList.add('listening');
      this.setStatus('Recording... [Whisper]', 'listening');
      this.transcriptEl.textContent = '';
    } catch (err) {
      console.error('Failed to start Whisper recording:', err);
      this.setStatus('Mic access denied', 'error');
    }
  }

  stopListening() {
    if (!this.isListening) return;

    if (this.transcriptionBackend === 'whisper' && this.mediaRecorder) {
      try {
        this.mediaRecorder.stop();
      } catch (err) {
        console.error('Failed to stop recording:', err);
      }
    } else if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (err) {
        console.error('Failed to stop recognition:', err);
      }
    }
  }

  async processWhisperRecording() {
    this.isListening = false;
    this.button.classList.remove('listening');
    this.setStatus('Transcribing...', 'processing');

    try {
      const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');

      // Use the combined transcribe+execute endpoint
      const response = await fetch('/api/whisper/command', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (result.success) {
        this.transcriptEl.textContent = result.transcript;
        this.setStatus(`${result.command} (${result.transcriptionTime}ms)`, 'success');
        this.showFeedback(result);
      } else {
        this.transcriptEl.textContent = result.transcript || '';
        this.setStatus(result.error || 'Command not recognized', 'error');
      }

      setTimeout(() => {
        this.setStatus('', 'idle');
        this.transcriptEl.textContent = '';
      }, 2000);
    } catch (err) {
      console.error('Whisper processing failed:', err);
      this.setStatus('Transcription failed', 'error');
      setTimeout(() => this.setStatus('', 'idle'), 3000);
    }
  }

  onStart() {
    console.log('Voice recognition started');
  }

  onEnd() {
    this.isListening = false;
    this.button.classList.remove('listening');

    // If we have a final transcript, process it
    const transcript = this.transcriptEl.textContent;
    if (transcript && transcript !== 'Listening...' && !transcript.startsWith('Error')) {
      this.processCommand(transcript);
    } else {
      this.setStatus('', 'idle');
    }
  }

  onResult(event) {
    let interimTranscript = '';
    let finalTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcript;
      } else {
        interimTranscript += transcript;
      }
    }

    // Show transcript
    this.transcriptEl.textContent = finalTranscript || interimTranscript;
  }

  onError(event) {
    console.error('Voice recognition error:', event.error);
    this.isListening = false;
    this.button.classList.remove('listening');

    if (event.error === 'no-speech') {
      this.setStatus('No speech detected', 'error');
    } else if (event.error === 'not-allowed') {
      this.setStatus('Microphone access denied', 'error');
    } else {
      this.setStatus(`Error: ${event.error}`, 'error');
    }

    setTimeout(() => this.setStatus('', 'idle'), 3000);
  }

  async processCommand(transcript) {
    this.setStatus('Processing...', 'processing');

    try {
      const response = await fetch('/api/voice/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript })
      });

      const result = await response.json();

      if (result.success) {
        this.setStatus(`${result.command}`, 'success');
        this.showFeedback(result);
      } else {
        this.setStatus(result.error || 'Command not recognized', 'error');
      }

      // Clear status after delay
      setTimeout(() => {
        this.setStatus('', 'idle');
        this.transcriptEl.textContent = '';
      }, 2000);

    } catch (err) {
      console.error('Failed to process voice command:', err);
      this.setStatus('Failed to process', 'error');
      setTimeout(() => this.setStatus('', 'idle'), 3000);
    }
  }

  setStatus(text, state) {
    this.statusEl.textContent = text;
    this.statusEl.className = `voice-status ${state}`;
    this.button.className = `voice-btn ${state}`;
  }

  showFeedback(result) {
    // Visual feedback for successful command
    if (result.command && result.result) {
      console.log('Voice command executed:', result);
    }
  }
}

// Export for use in app.js
window.VoiceControl = VoiceControl;
