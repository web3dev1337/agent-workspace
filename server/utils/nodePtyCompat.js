const KNOWN_BROKEN_NODE_PTY_VERSION = '1.2.0-beta.12';
const LOAD_NATIVE_MODULE_PATCH_FLAG = '__agentWorkspaceConptyCompatPatched';
const START_PROCESS_PATCH_FLAG = '__agentWorkspaceConptyStartProcessPatched';
const CONNECT_PATCH_FLAG = '__agentWorkspaceConptyConnectPatched';
const RESIZE_PATCH_FLAG = '__agentWorkspaceConptyResizePatched';
const CLEAR_PATCH_FLAG = '__agentWorkspaceConptyClearPatched';
const KILL_PATCH_FLAG = '__agentWorkspaceConptyKillPatched';
const DIRECT_CONPTY_NATIVE_CANDIDATES = [
  'node-pty/build/Release/conpty.node',
  'node-pty/build/Debug/conpty.node'
];

function isConptyUsageError(error, methodName) {
  const message = String(error?.message || '').trim();
  return message.includes(`Usage: pty.${methodName}(`);
}

function isStartProcessUsageError(error) {
  return isConptyUsageError(error, 'startProcess');
}

function isConnectUsageError(error) {
  return isConptyUsageError(error, 'connect');
}

function wrapConptyMethod(nativeModule, {
  methodName,
  patchFlag,
  retry
}) {
  if (!nativeModule || typeof nativeModule[methodName] !== 'function') {
    return false;
  }

  if (nativeModule[methodName][patchFlag]) {
    return false;
  }

  const originalMethod = nativeModule[methodName].bind(nativeModule);
  const wrappedMethod = function conptyCompat(...args) {
    try {
      return originalMethod(...args);
    } catch (error) {
      const nextArgs = retry({ args, error });
      if (!nextArgs) {
        throw error;
      }
      return originalMethod(...nextArgs);
    }
  };

  Object.defineProperty(wrappedMethod, patchFlag, {
    value: true,
    enumerable: false
  });

  nativeModule[methodName] = wrappedMethod;
  return true;
}

function wrapConptyStartProcess(nativeModule) {
  return wrapConptyMethod(nativeModule, {
    methodName: 'startProcess',
    patchFlag: START_PROCESS_PATCH_FLAG,
    retry: ({ args, error }) => {
      if (isStartProcessUsageError(error)) {
        if (args.length >= 7) {
          return args.slice(0, 6);
        }
        if (args.length === 6) {
          return [...args, false];
        }
      }
      return null;
    }
  });
}

function wrapConptyConnect(nativeModule) {
  return wrapConptyMethod(nativeModule, {
    methodName: 'connect',
    patchFlag: CONNECT_PATCH_FLAG,
    retry: ({ args, error }) => {
      if (isConnectUsageError(error)) {
        if (args.length >= 6) {
          return [args[0], args[1], args[2], args[3], args[5]];
        }
        if (args.length === 5) {
          return [args[0], args[1], args[2], args[3], false, args[4]];
        }
      }
      return null;
    }
  });
}

function parseExpectedArgCount(error) {
  const match = String(error?.message || '').match(/\(([^)]*)\)/);
  if (!match) return 0;
  return match[1].split(',').filter(Boolean).length;
}

function wrapConptyTrailingBooleanArg(nativeModule, methodName, patchFlag) {
  return wrapConptyMethod(nativeModule, {
    methodName,
    patchFlag,
    retry: ({ args, error }) => {
      if (isConptyUsageError(error, methodName)) {
        const expected = parseExpectedArgCount(error);
        if (expected > 0 && args.length > expected) {
          return args.slice(0, expected);
        }
        if (expected > 0 && args.length < expected) {
          const padded = [...args];
          while (padded.length < expected) padded.push(false);
          return padded;
        }
        if (args.length >= 2) {
          return args.slice(0, -1);
        }
      }
      return null;
    }
  });
}

function wrapConptyCompatMethods(nativeModule) {
  const patchedMethods = [];

  if (wrapConptyStartProcess(nativeModule)) {
    patchedMethods.push('startProcess');
  }
  if (wrapConptyConnect(nativeModule)) {
    patchedMethods.push('connect');
  }
  if (wrapConptyTrailingBooleanArg(nativeModule, 'resize', RESIZE_PATCH_FLAG)) {
    patchedMethods.push('resize');
  }
  if (wrapConptyTrailingBooleanArg(nativeModule, 'clear', CLEAR_PATCH_FLAG)) {
    patchedMethods.push('clear');
  }
  if (wrapConptyTrailingBooleanArg(nativeModule, 'kill', KILL_PATCH_FLAG)) {
    patchedMethods.push('kill');
  }

  return patchedMethods;
}

function patchConptyNativeModuleDirectly({
  requireModule = require
} = {}) {
  let lastError = null;

  for (const candidate of DIRECT_CONPTY_NATIVE_CANDIDATES) {
    try {
      const nativeModule = requireModule(candidate);
      const patchedMethods = wrapConptyCompatMethods(nativeModule);
      return {
        applied: patchedMethods.length > 0,
        reason: patchedMethods.length > 0 ? 'patched-direct-conpty-native' : 'already-patched',
        patchedMethods,
        candidate
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    applied: false,
    reason: 'missing-conpty-native-module',
    error: lastError
  };
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
    } catch {
      resolvedPackageInfo = null;
    }
  }

  const version = String(resolvedPackageInfo?.version || '').trim() || null;

  let utils = utilsModule;
  if (!utils) {
    try {
      utils = requireModule('node-pty/lib/utils');
    } catch {
      utils = null;
    }
  }

  if (utils && typeof utils.loadNativeModule === 'function') {
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
        const patchedMethods = wrapConptyCompatMethods(result.module);
        if (patchedMethods.length > 0) {
          result.compatPatchedMethods = patchedMethods;
        }
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

  const directPatch = patchConptyNativeModuleDirectly({ requireModule });
  return {
    ...directPatch,
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
  } else if (
    platform === 'win32'
    && !compat.applied
    && !['already-patched'].includes(String(compat.reason || '').trim())
    && logger?.warn
  ) {
    logger.warn('Could not apply node-pty ConPTY runtime compatibility patch', {
      reason: compat.reason || null,
      version: compat.version || null
    });
  }

  return requireModule('node-pty');
}

module.exports = {
  KNOWN_BROKEN_NODE_PTY_VERSION,
  ensureWindowsNodePtyCompat,
  isConnectUsageError,
  isConptyUsageError,
  isStartProcessUsageError,
  loadNodePty,
  patchConptyNativeModuleDirectly,
  wrapConptyCompatMethods,
  wrapConptyConnect,
  wrapConptyStartProcess
};
