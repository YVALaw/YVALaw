// Installer settings for `npm run dist` (Windows, NSIS).
//
// Updates: `publish` points the installed app at this repository's GitHub Releases, so
// electron-updater finds new versions there (latest.yml, written next to the installer).
//
// Code signing switches on by itself when these are set (GitHub → Settings → Secrets and
// variables → Actions; see YVA Time/README.md → "Code signing"):
//   Azure Trusted Signing: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET (secrets) and
//                          YVA_SIGN_ENDPOINT, YVA_SIGN_ACCOUNT, YVA_SIGN_PROFILE, YVA_SIGN_PUBLISHER
//   or a certificate file: CSC_LINK + CSC_KEY_PASSWORD (read by electron-builder directly)
// Without them the installer is built unsigned (Windows shows "unknown publisher").
const env = process.env
const azure = env.YVA_SIGN_ENDPOINT && env.YVA_SIGN_ACCOUNT && env.YVA_SIGN_PROFILE && env.YVA_SIGN_PUBLISHER

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'agency.yvastaffing.time',
  productName: 'YVA Time',
  directories: { output: 'release', buildResources: 'build' },
  files: ['dist/**/*', 'resources/**/*', 'package.json'],
  win: {
    target: 'nsis',
    icon: 'build/icon.png',
    artifactName: 'YVA-Time-Setup.${ext}',
    ...(azure ? {
      azureSignOptions: {
        endpoint: env.YVA_SIGN_ENDPOINT,
        codeSigningAccountName: env.YVA_SIGN_ACCOUNT,
        certificateProfileName: env.YVA_SIGN_PROFILE,
        publisherName: env.YVA_SIGN_PUBLISHER,
      },
    } : {}),
  },
  nsis: { oneClick: true, perMachine: false, runAfterFinish: true },
  protocols: [{ name: 'YVA Time', schemes: ['yvatime'] }],
  publish: [{ provider: 'github', owner: 'YVALaw', repo: 'YVALaw', releaseType: 'release' }],
}
