// Lets React Native / Expo community autolinking discover this library's
// native code (iOS podspec + Android build.gradle) in the consuming app.
module.exports = {
  dependency: {
    platforms: {
      ios: {
        podspecPath: __dirname + '/AudioEngine.podspec',
      },
      android: {
        // sourceDir is the android/ folder relative to the package root.
        sourceDir: './android',
      },
    },
  },
};
