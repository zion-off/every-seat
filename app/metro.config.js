const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('metro-config').MetroConfig}
 */
// The demo household is a JSON file in the repository's fixtures folder, imported by the app.
const FIXTURES = path.resolve(__dirname, '../fixtures');

const config = {
  watchFolders: [FIXTURES],
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
