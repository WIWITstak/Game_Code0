'use strict';
// Standalone dev tool — visual editor for STORY_DIALOGUES/STORY_SPEAKERS
// (game-story.js) and OBJECTIVES (game-data.js). Not shipped with the game
// (not in package.json's build.files). Launch with:  npx electron tools/editor.js
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1500,
    height: 940,
    title: 'MARS AWAKENING — редактор диалогов и заданий',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  win.loadFile(path.join(__dirname, 'editor.html'));
});

app.on('window-all-closed', () => app.quit());
