// =====================================================================
//  Clinic Doctor - Prescription Software
//  Electron main process
// =====================================================================

const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    title: 'Clinic Management & Prescription System',
    icon: path.join(__dirname, 'images', 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true
    },
    show: false                  // wait for ready-to-show before displaying
  });

  // Load the app
  mainWindow.loadFile('index.html');

  // Show maximised once loaded (no white flash)
  mainWindow.once('ready-to-show', function () {
    mainWindow.maximize();
    mainWindow.show();
  });

  // Remove default menu bar (File / Edit / View …)
  Menu.setApplicationMenu(null);

  // Allow print popup windows (window.open('', '_blank', …)), but open real
  // external links (e.g. WhatsApp wa.me) in the user's default browser / WhatsApp.
  mainWindow.webContents.setWindowOpenHandler(function (details) {
    var u = details.url || '';
    if (/^https?:\/\//i.test(u)) {
      shell.openExternal(u);
      return { action: 'deny' };
    }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 900,
        height: 1200,
        title: 'Print Preview',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          webSecurity: true
        }
      }
    };
  });
}

app.whenReady().then(function () {
  createWindow();
});

app.on('window-all-closed', function () {
  app.quit();
});
