const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const exclusionList = require('metro-config/src/defaults/exclusionList');

// Temporary local link to the react-native-sensevtt sources in the sibling checkout. Metro does
// not follow symlinked packages, so the package is aliased to this path. Replace this block and
// the `paths` entries in tsconfig.json with the published package.
const SENSEVTT_LIBRARY = path.resolve(
  __dirname,
  '../../sensevtt/packages/react-native-sensevtt',
);

// The library's own dependencies resolve to this app's copies, so the bundle has one React and
// one React Native.
const appModules = new Proxy(
  {},
  { get: (_, name) => path.join(__dirname, 'node_modules', String(name)) },
);

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  watchFolders: [SENSEVTT_LIBRARY],
  resolver: {
    blockList: exclusionList([new RegExp(`${SENSEVTT_LIBRARY}/node_modules/.*`)]),
    extraNodeModules: new Proxy(
      {
        'react-native-sensevtt': SENSEVTT_LIBRARY,
        'react-native-sensevtt/react': path.join(SENSEVTT_LIBRARY, 'react'),
      },
      {
        get: (target, name) =>
          name in target ? target[name] : appModules[name],
      },
    ),
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
