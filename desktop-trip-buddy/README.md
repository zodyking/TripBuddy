# Trip Buddy — lightweight desktop shell

This is a **minimal Tauri 2** app: it opens FedEx dispatch in the **OS WebView** (WebKit on macOS, WebView2 on Windows, WebKitGTK on Linux). It is **not** an iframe in a browser tab, so FedEx’s `X-Frame-Options` does not apply.

**Binary size:** Tauri uses the system webview — there is no bundled Chromium (unlike Electron).

## URL

Default load URL matches `server/config.mjs` (`DISPATCH_ENTRY_URL`):

`https://fdxtools.fedex.com/grdlhldispatch/home`

Change it in `src-tauri/tauri.conf.json` under `build.devUrl` and `build.frontendDist`.

## Prerequisites

- **Rust** (stable): https://rustup.rs  
- **Node** (for `@tauri-apps/cli`)  
- **OS-specific** (see https://tauri.app/start/prerequisites/ ):
  - **Linux:** `webkit2gtk`, `libayatana-appindicator`, GTK — e.g. Debian/Ubuntu:  
    `sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf`
  - **macOS:** Xcode CLI tools  
  - **Windows:** WebView2 (usually already installed)

## Commands

```bash
cd desktop-trip-buddy
npm install
npm run tauri dev      # development
npm run tauri build    # release installer / binary
```

## Relation to the web app

The Vue app’s **Trip Buddy** tab still uses the server **proxy** (`/embed/trip-buddy`) for in-browser embedding. This folder is an optional **native** alternative when you want a real desktop window.
