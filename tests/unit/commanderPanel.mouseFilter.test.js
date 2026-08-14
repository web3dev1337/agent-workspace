const fs = require('fs');
const path = require('path');
const vm = require('vm');

// client/commander-panel.js is a browser script (assigns window.CommanderPanel at the
// top level), so evaluate it in a sandbox instead of require()-ing it. Only the class
// declaration runs at load time; no DOM access happens until instantiation.
const loadCommanderPanelClass = () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'commander-panel.js'), 'utf8');
  const sandbox = { window: { location: { origin: 'http://localhost' } } };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.window.CommanderPanel;
};

describe('CommanderPanel.stripMouseMotionReports', () => {
  const ESC = '\x1b';
  let strip;

  beforeAll(() => {
    const CommanderPanel = loadCommanderPanelClass();
    strip = CommanderPanel.prototype.stripMouseMotionReports;
  });

  const x10 = (btnCode) => `${ESC}[M${String.fromCharCode(32 + btnCode, 42, 52)}`;

  test('strips SGR idle-hover motion reports (the flood)', () => {
    expect(strip.call({}, `${ESC}[<35;10;20M`)).toBe('');
    expect(strip.call({}, `${ESC}[<51;10;20M`)).toBe(''); // motion + ctrl modifier
    expect(strip.call({}, `${ESC}[<35;1;1M`.repeat(50))).toBe('');
  });

  test('strips X10-encoded idle-hover motion reports', () => {
    expect(strip.call({}, x10(35))).toBe('');
  });

  test('forwards clicks, releases, drags, and scroll-wheel reports', () => {
    for (const report of [
      `${ESC}[<0;10;20M`,  // left press
      `${ESC}[<0;10;20m`,  // left release
      `${ESC}[<32;10;20M`, // left-button drag motion
      `${ESC}[<64;10;20M`, // scroll up
      `${ESC}[<65;10;20M`, // scroll down
      x10(0)               // X10 click
    ]) {
      expect(strip.call({}, report)).toBe(report);
    }
  });

  test('preserves real input coalesced into the same chunk as motion noise', () => {
    expect(strip.call({}, `${ESC}[<35;1;1Mabc`)).toBe('abc');
    expect(strip.call({}, `a${ESC}[<35;1;1Mb`)).toBe('ab');
  });

  test('leaves keyboard escape sequences and plain text untouched', () => {
    for (const input of [
      'hello',
      `${ESC}[A`,                    // arrow up
      `${ESC}[1;5C`,                 // ctrl+right
      `${ESC}[200~line1\rline2${ESC}[201~` // bracketed paste
    ]) {
      expect(strip.call({}, input)).toBe(input);
    }
  });
});
