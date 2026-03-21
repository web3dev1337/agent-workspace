const KNOWN_BROKEN_NODE_PTY_VERSION = '1.2.0-beta.12';
const LOAD_NATIVE_MODULE_PATCH_FLAG = '__agentWorkspaceConptyCompatPatched';
const START_PROCESS_PATCH_FLAG = '__agentWorkspaceConptyStartProcessPatched';

function isStartProcessUsageError(error) {
  const message = String(error?.message || '').trim();
  return message.includes('Usage: pty.startProcess(');
}

function wrapConptyStartProcess(nativeModule) {
  if (!nativeModule || typeof nativeModule.startProcess !== 'function') {
    return false;
  }

  if (nativeModule.startProcess[START_PROCESS_PATCH_FLAG]) {
    return false;
  }

  const originalStartProcess = nativeModule.startProcess.bind(nativeModule);
  const wrappedStartProcess = function startProcessCompat(...args) {
    try {
      return originalStartProcess(...args);
    } catch (error) {
      if (args.length >= 7 && isStartProcessUsageError(error)) {
        return originalStartProcess(...args.slice(0, 6));
      }
      throw error;
    }
  };

  Object.defineProperty(wrappedStartProcess, START_PROCESS_PATCH_FLAG, {
    value: true,
    enumerable: false
  });

  nativeModule.startProcess = wrappedStartProcess;
  return true;
}

function ensureWindowsNodePtyCompat({
  platform = process.platform,
  utilsModule = null,
  packageInfo = null,
  requireModule = require
} = {}) {
  if (platform !== 'win32') {
    return { applied: false, reason: 'not-windows' };
  }

  let resolvedPackageInfo = packageInfo;
  if (!resolvedPackageInfo) {
    try {
      resolvedPackageInfo = requireModule('node-pty/package.json');
    } catch (error) {
      return {
        applied: false,
        reason: 'missing-package-info',
        error: error
      };
    }
  }

  const version = String(resolvedPackageInfo?.version || '').trim();
  if (version !== KNOWN_BROKEN_NODE_PTY_VERSION) {
    return {
      applied: false,
      reason: 'version-not-affected',
      version
    };
  }

  let utils = utilsModule;
  if (!utils) {
    try {
      utils = requireModule('node-pty/lib/utils');
    } catch (error) {
      return {
        applied: false,
        reason: 'missing-utils-module',
        version,
        error
      };
    }
  }

  if (!utils || typeof utils.loadNativeModule !== 'function') {
    return {
      applied: false,
      reason: 'missing-utils-module',
      version
    };
  }

  if (utils.loadNativeModule[LOAD_NATIVE_MODULE_PATCH_FLAG]) {
    return {
      applied: false,
      reason: 'already-patched',
      version
    };
  }

  const originalLoadNativeModule = utils.loadNativeModule.bind(utils);
  const wrappedLoadNativeModule = function loadNativeModuleCompat(name) {
    const result = originalLoadNativeModule(name);
    if (name === 'conpty' && result?.module) {
      wrapConptyStartProcess(result.module);
    }
    return result;
  };

  Object.defineProperty(wrappedLoadNativeModule, LOAD_NATIVE_MODULE_PATCH_FLAG, {
    value: true,
    enumerable: false
  });

  utils.loadNativeModule = wrappedLoadNativeModule;
  return {
    applied: true,
    reason: 'patched-load-native-module',
    version
  };
}

function loadNodePty({
  platform = process.platform,
  logger = null,
  utilsModule = null,
  packageInfo = null,
  requireModule = require
} = {}) {
  const compat = ensureWindowsNodePtyCompat({
    platform,
    utilsModule,
    packageInfo,
    requireModule
  });

  if (compat.applied && logger?.info) {
    logger.info('Applied node-pty ConPTY runtime compatibility patch', {
      version: compat.version
    });
  } else if (platform === 'win32' && compat.reason === 'missing-utils-module' && logger?.warn) {
    logger.warn('Could not apply node-pty ConPTY runtime compatibility patch', {
      version: compat.version || null
    });
  }

  return requireModule('node-pty');
}

module.exports = {
  KNOWN_BROKEN_NODE_PTY_VERSION,
  ensureWindowsNodePtyCompat,
  isStartProcessUsageError,
  loadNodePty,
  wrapConptyStartProcess
};
