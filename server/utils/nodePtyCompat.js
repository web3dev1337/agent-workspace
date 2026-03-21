const KNOWN_BROKEN_NODE_PTY_VERSION = '1.2.0-beta.12';
const LOAD_NATIVE_MODULE_PATCH_FLAG = '__agentWorkspaceConptyCompatPatched';
const START_PROCESS_PATCH_FLAG = '__agentWorkspaceConptyStartProcessPatched';
const CONNECT_PATCH_FLAG = '__agentWorkspaceConptyConnectPatched';
const RESIZE_PATCH_FLAG = '__agentWorkspaceConptyResizePatched';
const CLEAR_PATCH_FLAG = '__agentWorkspaceConptyClearPatched';
const KILL_PATCH_FLAG = '__agentWorkspaceConptyKillPatched';

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
      if (args.length >= 7 && isStartProcessUsageError(error)) {
        return args.slice(0, 6);
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
      if (args.length >= 6 && isConnectUsageError(error)) {
        return [args[0], args[1], args[2], args[3], args[5]];
      }
      return null;
    }
  });
}

function wrapConptyTrailingBooleanArg(nativeModule, methodName, patchFlag) {
  return wrapConptyMethod(nativeModule, {
    methodName,
    patchFlag,
    retry: ({ args, error }) => {
      if (args.length >= 2 && isConptyUsageError(error, methodName)) {
        return args.slice(0, -1);
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
  isConnectUsageError,
  isConptyUsageError,
  isStartProcessUsageError,
  loadNodePty,
  wrapConptyCompatMethods,
  wrapConptyConnect,
  wrapConptyStartProcess
};
