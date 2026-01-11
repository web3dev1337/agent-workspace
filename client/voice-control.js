/**
 * VoiceControl - Push-to-talk voice command interface
 *
 * Uses Web Speech API for recognition, sends to server for parsing/execution
 */

class VoiceControl {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.recognition = null;
    this.isListening = false;
    this.button = null;
    this.statusEl = null;
    this.transcriptEl = null;

    this.init();
  }

  init() {
    // Check for Web Speech API support
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('Web Speech API not supported in this browser');
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = false;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';

    this.recognition.onstart = () => this.onStart();
    this.recognition.onend = () => this.onEnd();
    this.recognition.onresult = (e) => this.onResult(e);
    this.recognition.onerror = (e) => this.onError(e);

    this.createUI();
    this.setupKeyboardShortcut();
  }

  createUI() {
    // Create voice control container
    const container = document.createElement('div');
    container.id = 'voice-control';
    container.className = 'voice-control';
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
  }

  async loadCommandsTooltip() {
    try {
      const response = await fetch('/api/voice/commands');
      const commands = await response.json();
      const tooltip = 'Voice Commands (hold or press V):\n' + 
        commands.map(c => '• ' + c.command.replace(/-/g, ' ')).join('\n');
      this.button.title = tooltip;
    } catch (err) {
      this.button.title = 'Voice Commands (hold or press V)';
    }
  }

  setupKeyboardShortcut() {
    // V key for push-to-talk
    document.addEventListener('keydown', (e) => {
      if (e.key === 'v' && !e.repeat && !this.isInputFocused()) {
        e.preventDefault();
        this.startListening();
      }
    });

    document.addEventListener('keyup', (e) => {
      if (e.key === 'v' && !this.isInputFocused()) {
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
    if (this.isListening || !this.recognition) return;

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

  stopListening() {
    if (!this.isListening || !this.recognition) return;

    try {
      this.recognition.stop();
    } catch (err) {
      console.error('Failed to stop recognition:', err);
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
