const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

config.resolver.extraNodeModules = new Proxy(
  {
    'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
  },
  {
    get: (target, name) => {
      if (name in target) return target[name];
      return path.resolve(workspaceRoot, 'node_modules', name);
    },
  }
);

// Force ALL react-native imports (including from nested node_modules in
// @react-navigation/*, react-native-safe-area-context, etc.) to resolve to
// the single main copy. Without this, each package's nested react-native
// copy runs its own BatchedBridge/InitializeCore, overwriting
// global.__fbBatchedBridge and clearing the callable module registry (n=0).
const mainReactNativeRoot = path.resolve(projectRoot, 'node_modules/react-native');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react-native' || moduleName.startsWith('react-native/')) {
    // Resolve as if the require() originated from within the main project
    // so Metro finds apps/mobile/node_modules/react-native instead of any
    // nested copy inside a transitive dependency.
    return context.resolveRequest(
      {
        ...context,
        originModulePath: path.join(mainReactNativeRoot, 'index.js'),
      },
      moduleName,
      platform,
    );
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
