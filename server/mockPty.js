// Mock implementation of node-pty for Windows development
const { EventEmitter } = require('events');
const { exec } = require('child_process');

class MockPty extends EventEmitter {
  constructor(shell, args, options) {
    super();
    this.shell = shell;
    this.args = args;
    this.options = options;
    this.process = null;
    this._pid = Math.floor(Math.random() * 10000);
    
    // Set up event handlers using node-pty compatible API
    this.onData = (handler) => {
      this.on('data', handler);
    };
    
    this.onExit = (handler) => {
      this.on('exit', handler);
    };
    
    // Use Windows cmd.exe instead
    const { spawn } = require('child_process');
    
    // For Windows, properly handle cmd.exe commands
    if (process.platform === 'win32' && shell === 'cmd.exe') {
      this.process = spawn(shell, args, {
        cwd: options.cwd,
        env: options.env,
        windowsHide: true,
        shell: false
      });
    } else {
      const cmd = `${shell} ${args.join(' ')}`;
      this.process = exec(cmd, {
        cwd: options.cwd,
        env: options.env,
        shell: true,
        windowsHide: true
      });
    }
    
    this.process.stdout.on('data', (data) => {
      this.emit('data', data.toString());
    });
    
    this.process.stderr.on('data', (data) => {
      this.emit('data', data.toString());
    });
    
    this.process.on('exit', (code) => {
      this.emit('exit', { exitCode: code, signal: null });
    });
  }
  
  write(data) {
    if (this.process && this.process.stdin) {
      this.process.stdin.write(data);
    }
  }
  
  resize(cols, rows) {
    // No-op for mock
  }
  
  kill(signal) {
    if (this.process) {
      this.process.kill(signal);
    }
  }
  
  get pid() {
    return this._pid;
  }
}

module.exports = {
  spawn: (shell, args, options) => new MockPty(shell, args, options)
};