# DocBox — V Modi & Associates, Vadodara

Clients send bills, vouchers and bank statements from their phone. The office reads them with AI, checks the figures and exports Tally ERP 9 import files.

## What is in this project

| Folder | What it is |
|---|---|
| `web/` | The app itself (client screens and office screens). Published free on GitHub Pages. |
| `web/config.js` | **The only file you edit**: your Supabase Project URL and anon public key. |
| `android/` | The Android app (.apk) that opens DocBox on clients' phones, with camera upload. |
| `supabase/setup.sql` | Creates the database, security rules and file storage. Run once in Supabase. |
| `.github/workflows/build.yml` | Builds the website and the .apk automatically on every change. |

## Where things appear after each build

- **APK for phones**: this repository → **Releases** → latest → `DocBox.apk`
  Permanent link: `https://github.com/<your-username>/<repo>/releases/latest/download/DocBox.apk`
- **Office and web version**: `https://<your-username>.github.io/<repo>/`

Follow the setup guide for the full step-by-step instructions.

## Notes

- The signing key (`android/app/docbox.keystore`) is kept in the project so every new build can update the installed app. Anyone with a copy of this project could sign an app with it; keep the repository's contents to yourself and don't publish the APK on other sites.
- Bills are read with the office's own Anthropic API key, entered in Office → Tally ledgers & AI settings. It is stored only in that computer's browser.
