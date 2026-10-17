// app.json holds the configuration; this file only adds what comes from the
// environment at build time.
//
// GOOGLE_MAPS_ANDROID_API_KEY: the Google Maps key for Android store and
// development builds (Expo Go has its own). The plugin writes it into the
// Android manifest, so anyone holding the APK can read it; what guards it is the
// restriction to this package and its signing certificates, set on the key in
// Google Cloud. It isn't EXPO_PUBLIC_, so it stays out of the JavaScript bundle,
// and it isn't committed: EAS supplies it as a sensitive variable, since secret
// ones aren't readable while the config resolves. See docs/development.md.
module.exports = ({ config }) => ({
  ...config,
  plugins: [
    ...config.plugins,
    ['react-native-maps', { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY }],
  ],
});
