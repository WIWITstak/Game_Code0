'use strict';
// Native shell for the game. It does NOT change how the game runs — it starts
// the same local static server (server.js) on a random free port and points a
// Chromium window at it, exactly like opening http://127.0.0.1 in a browser,
// just without the browser chrome. This is the interim "get off the browser"
// step; a hand-rolled engine is the longer-term plan.
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
const server = require('./server');

// The game is served from a local file server; there is never a reason to
// cache it, and a stale index.html would keep loading old ?v= script versions.
app.commandLine.appendSwitch('disable-http-cache');

let win = null;

function createWindow(port) {
  win = new BrowserWindow({
    // launches fullscreen; F11 toggles windowed (see the key handler below)
    fullscreen: true,
    width: 1600,
    height: 900,
    minWidth: 1024,
    minHeight: 576,
    backgroundColor: '#0b0f14',
    autoHideMenuBar: true,
    title: 'MARS: AWAKENING',
    icon: path.join(__dirname, 'assets', 'icon.png'),  // optional — ignored if absent
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // the game runs a 40ms setInterval loop; don't let Chromium throttle it
      // to 1 Hz when the window is backgrounded / on the sim + render loop
      backgroundThrottling: false
    }
  });

  Menu.setApplicationMenu(null);
  const foreground = () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.moveTop();
    win.focus();
    win.webContents.focus();
  };
  // grab foreground + keyboard focus even when launched from MARS.vbs, and
  // again once the page is in — otherwise a window that opened in the
  // background reports document.hidden and the sim loop idles.
  win.once('ready-to-show', foreground);
  win.webContents.once('did-finish-load', () => setTimeout(foreground, 120));
  win.loadURL('http://127.0.0.1:' + port + '/');

  // external links never open inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // The game listens for keys on `document`, so WASD / Space / 1-2-3 work the
  // same fullscreen or windowed — as long as the page holds keyboard focus.
  // Windows can drop page focus to the native frame when the window is
  // activated or toggled out of fullscreen, so pull it back every time.
  const refocus = () => { if (win && !win.isDestroyed()) win.webContents.focus(); };

  // F11 = toggle fullscreen / windowed, F12 = devtools (dev builds only)
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); refocus(); e.preventDefault(); }
    if (input.key === 'F12' && !app.isPackaged) { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
  win.on('enter-full-screen', refocus);
  win.on('leave-full-screen', () => { if (win) win.center(); refocus(); });
  win.on('focus', refocus);
  win.on('show', refocus);

  win.on('closed', () => { win = null; });
}

// one instance only
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

  app.whenReady().then(() => {
    server.start(0, (port) => createWindow(port));
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) server.start(0, createWindow); });
  });

  app.on('window-all-closed', () => app.quit());
}
