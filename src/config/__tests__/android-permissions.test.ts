import path from 'path';

/**
 * Expo's default Android template declares permissions Press never uses. A
 * store build that declares them has to explain them on the listing and in
 * Google Play's Data safety form, so `android.blockedPermissions` strips them
 * from the merged manifest (`tools:node="remove"`). This is a check on the
 * resolved app config: the merged manifest itself only exists after prebuild,
 * and the production `.aab` is checked with bundletool before submission.
 * See docs/development.md § Android permissions.
 */

const ROOT = path.join(__dirname, '..', '..', '..');

type AndroidConfig = { permissions?: string[]; blockedPermissions?: string[] };

function resolvedAndroidConfig(): AndroidConfig {
  const appJson = require(path.join(ROOT, 'app.json')) as { expo: Record<string, unknown> };
  const withEnvironment = require(path.join(ROOT, 'app.config.js')) as (ctx: {
    config: Record<string, unknown>;
  }) => { android?: AndroidConfig };
  return withEnvironment({ config: appJson.expo }).android ?? {};
}

const UNUSED = [
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
];

describe('Android permissions', () => {
  const android = resolvedAndroidConfig();

  it.each(UNUSED)('blocks %s, which the default template adds', (permission) => {
    expect(android.blockedPermissions).toContain(permission);
  });

  it('blocks the advertising ID, which the Data safety form says Press never reads', () => {
    expect(android.blockedPermissions).toContain('com.google.android.gms.permission.AD_ID');
  });

  it('never blocks a permission Press needs', () => {
    const needed = [
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.INTERNET',
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.VIBRATE',
    ];
    for (const permission of needed) {
      expect(android.blockedPermissions ?? []).not.toContain(permission);
    }
  });

  it('never asks for a blocked permission', () => {
    const asked = android.permissions ?? [];
    for (const permission of android.blockedPermissions ?? []) {
      expect(asked).not.toContain(permission);
    }
  });
});
