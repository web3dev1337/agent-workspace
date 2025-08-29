# Claude Orchestrator Linting System

## Overview

Claude Orchestrator uses ESLint for JavaScript/Node.js code quality and style checking, along with additional tools for Rust code in the Tauri native app component.

## Why This Setup?

This project spans multiple technologies (Node.js, JavaScript, Rust) and requires consistent code quality across all components. The linting setup ensures:
- Consistent code style across all JavaScript/Node.js files
- Proper error handling patterns for async operations
- Security best practices for server-side code
- Rust code quality for the Tauri native app

## Available Commands

### 1. `npm run lint`
- **What it does**: Runs ESLint on all JavaScript files
- **Covers**: Server code, client code, configuration files
- **Use when**: Before committing changes or during development
- **Command**: `eslint server/ client/ *.js`

### 2. `npm run lint:fix`
- **What it does**: Automatically fixes ESLint issues where possible
- **Fixes**: Formatting, spacing, simple style issues
- **Use when**: Quick cleanup of code style issues
- **Command**: `eslint --fix server/ client/ *.js`

### 3. Node.js Syntax Check
- **What it does**: Validates JavaScript syntax without execution
- **Use when**: Quick syntax validation before testing
- **Command**: `node --check filename.js`

### 4. Rust Linting (Tauri)
```bash
# In src-tauri directory
cargo clippy        # Rust linter
cargo fmt          # Rust formatter
cargo check        # Syntax and type checking
```

## ESLint Configuration

### Core Rules
```javascript
module.exports = {
  env: {
    node: true,
    es2022: true,
    browser: true  // For client-side code
  },
  extends: ['eslint:recommended'],
  rules: {
    // Error Prevention
    'no-console': 'warn',           // Prefer structured logging
    'no-unused-vars': 'error',      // Catch unused variables
    'no-undef': 'error',            // Catch undefined variables
    
    // Async/Promise Handling
    'require-await': 'error',       // Ensure async functions use await
    'no-async-promise-executor': 'error',
    'prefer-promise-reject-errors': 'error',
    
    // Security
    'no-eval': 'error',             // Prevent eval usage
    'no-implied-eval': 'error',     // Prevent implied eval
    'no-new-func': 'error',         // Prevent Function constructor
    
    // Code Quality
    'prefer-const': 'error',        // Use const when possible
    'no-var': 'error',              // Prefer let/const over var
    'eqeqeq': 'error',              // Require === and !==
    
    // Style (auto-fixable)
    'semi': ['error', 'always'],    // Require semicolons
    'quotes': ['error', 'single'],  // Single quotes
    'indent': ['error', 2],         // 2-space indentation
    'comma-trailing': ['error', 'never'], // No trailing commas
  }
};
```

### Project-Specific Rules
```javascript
// Additional rules for this project
rules: {
  // Server-side specific
  'no-process-exit': 'error',      // Prefer graceful shutdown
  'no-sync-methods': 'warn',       // Prefer async methods
  
  // Socket.IO specific  
  'no-unused-expressions': 'off',  // Allow socket.emit() patterns
  
  // Terminal/PTY specific
  'no-control-regex': 'off',       // Allow control characters in terminal
  
  // Git operations
  'no-shell-escape': 'error',      // Prevent shell injection
}
```

## File-Specific Configuration

### Server Files (`server/**/*.js`)
```javascript
// Additional rules for server-side code
overrides: [{
  files: ['server/**/*.js'],
  rules: {
    'no-console': 'error',         // Strict: use Winston logger only
    'require-await': 'error',      // All async functions must await
    'no-process-env': 'warn',      // Prefer config files
  }
}]
```

### Client Files (`client/**/*.js`)
```javascript
// Browser-specific rules
overrides: [{
  files: ['client/**/*.js'],
  env: { browser: true, node: false },
  rules: {
    'no-console': 'warn',          // Console allowed in browser
    'no-undef': 'error',           // Catch undefined globals
  }
}]
```

### Configuration Files
```javascript
// Config files have relaxed rules
overrides: [{
  files: ['*.config.js', 'config.json'],
  rules: {
    'no-console': 'off',
    'quotes': 'off',
  }
}]
```

## Common Scenarios

### Before Committing Code
```bash
npm run lint              # Check all issues
npm run lint:fix          # Auto-fix what's possible
npm run lint              # Verify remaining issues
```

### Server-Side Development
```bash
node --check server/index.js     # Syntax check
npm run lint server/             # Lint server code
npm test                         # Run tests if available
```

### Client-Side Development
```bash
npm run lint client/             # Lint client code
# Test in browser
```

### Tauri Development
```bash
cd src-tauri
cargo clippy                     # Rust linting
cargo fmt                        # Format Rust code
cargo check                      # Type checking
```

## Understanding the Output

### ESLint Error Format
```
server/sessionManager.js
  23:5  error  'unusedVar' is defined but never used  no-unused-vars
  45:12 warning  Unexpected console statement        no-console
  67:8  error  Missing semicolon                     semi
```

### Rust Clippy Output
```
warning: this expression can be written more concisely
 --> src/main.rs:42:13
   |
42 |     let x = if condition { true } else { false };
   |             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ help: try: `condition`
```

## Troubleshooting

### "ESLint couldn't determine parser"
- Ensure all `.js` files have valid syntax
- Check for missing dependencies in `package.json`

### "Parsing error: Unexpected token"
- File may have syntax errors
- Run `node --check filename.js` to verify syntax

### False Positives
- Terminal/PTY code may trigger control character warnings
- Socket.IO patterns may trigger expression warnings
- Use `eslint-disable-next-line` for specific exceptions

### Performance Issues
- ESLint can be slow on large files
- Use `.eslintignore` to exclude generated files
- Consider running lint only on changed files

## Best Practices

### Code Quality
1. **Fix errors before warnings** - Errors indicate real problems
2. **Use structured logging** instead of console statements
3. **Handle async operations properly** with try/catch
4. **Validate inputs** especially for server endpoints
5. **Use const/let** instead of var consistently

### Development Workflow
1. **Run lint frequently** during development
2. **Use lint:fix** for automatic cleanup
3. **Address warnings** - they often indicate code smells
4. **Test after fixing** - auto-fixes can change behavior
5. **Configure editor** to show ESLint errors inline

### Project-Specific Guidelines
1. **Server code**: Zero tolerance for console.log, use Winston
2. **Client code**: Console allowed but prefer notifications
3. **Socket events**: Ensure proper error handling
4. **Git operations**: Always validate and sanitize commands
5. **Terminal I/O**: Handle special characters correctly

## Integration with IDEs

### VS Code
```json
// .vscode/settings.json
{
  "eslint.enable": true,
  "eslint.autoFixOnSave": true,
  "eslint.workingDirectories": [
    "./server",
    "./client"
  ],
  "[rust]": {
    "editor.defaultFormatter": "rust-lang.rust"
  }
}
```

### Other Editors
- Ensure ESLint plugin is installed
- Configure to use project's ESLint config
- Enable auto-fix on save for minor issues

## Migration Notes

### From No Linting
- Expect many initial warnings/errors
- Fix gradually, starting with errors
- Use `eslint:fix` for easy wins
- Focus on security and bug-prone patterns first

### Adding New Rules
- Test on small subset first
- Consider impact on existing code
- Document any project-specific exceptions
- Update this documentation when adding rules