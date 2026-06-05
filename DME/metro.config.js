const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');

/**
 * Metro configuration
 */
const projectRoot = __dirname;

const config = {
  projectRoot: projectRoot,
  watchFolders: [projectRoot],
  resolver: {
    blockList: [
      /node_modules\/.*\/android\/\.cxx\/.*/,
      /android\/.*\/\.cxx\/.*/,
    ],
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);