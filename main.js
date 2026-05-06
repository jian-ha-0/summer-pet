const { app, BrowserWindow, ipcMain, Tray, Menu, Notification, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(app.getPath('userData'), 'summer-pet');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadLogs() {
  try {
    return JSON.parse(fs.readFileSync(LOGS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveLogs(logs) {
  fs.writeFileSync(LOGS_FILE, JSON.stringify(logs, null, 2));
}

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {
    return {
      reminderInterval: 60,
      enabled: true,
      petPosition: { x: null, y: null }
    };
  }
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

let petWindow;
let logWindow;
let tray;
let reminderTimer;
let settings = loadSettings();

function createPetWindow() {
  const { width: screenW, height: screenH } = require('electron').screen.getPrimaryDisplay().workAreaSize;
  const x = settings.petPosition.x || screenW - 220;
  const y = settings.petPosition.y || screenH - 280;

  petWindow = new BrowserWindow({
    width: 200,
    height: 260,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  petWindow.loadFile(path.join(__dirname, 'pet.html'));

  petWindow.on('moved', () => {
    const [x, y] = petWindow.getPosition();
    settings.petPosition = { x, y };
    saveSettings(settings);
  });

  petWindow.on('closed', () => {
    petWindow = null;
  });
}

function createLogWindow() {
  if (logWindow) {
    logWindow.focus();
    return;
  }

  logWindow = new BrowserWindow({
    width: 520,
    height: 680,
    title: '日志记录',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  logWindow.loadFile(path.join(__dirname, 'log.html'));

  logWindow.on('closed', () => {
    logWindow = null;
  });
}

function createTrayIcon() {
  const size = 32;
  const canvas = document?.createElement?.('canvas');
  if (canvas) {
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#4FC3F7';
    ctx.beginPath();
    ctx.arc(size/2, size/2, size/2 - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFD54F';
    ctx.beginPath();
    ctx.arc(size/2, size/2, size/4, 0, Math.PI * 2);
    ctx.fill();
    return nativeImage.createFromDataURL(canvas.toDataURL());
  }
  // Fallback: create from buffer
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
      <circle cx="16" cy="16" r="15" fill="#4FC3F7"/>
      <circle cx="16" cy="16" r="8" fill="#FFD54F"/>
    </svg>
  `;
  return nativeImage.createFromBuffer(Buffer.from(svg));
}

function createTray() {
  if (tray) tray.destroy();
  const trayIcon = nativeImage.createFromNamedImage('NSImageNameComputer', [16, 16]);
  // Try to create a simple icon from a buffer if named image fails
  const svgBuffer = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
    <rect width="32" height="32" rx="4" fill="#4FC3F7"/>
    <circle cx="16" cy="16" r="10" fill="#FFD54F"/>
    <circle cx="12" cy="14" r="2" fill="#333"/>
    <circle cx="20" cy="14" r="2" fill="#333"/>
    <path d="M12 22 Q16 25 20 22" stroke="#333" stroke-width="1.5" fill="none"/>
  </svg>`);
  const icon = nativeImage.createFromBuffer(svgBuffer, { scaleFactor: 1 });

  tray = new Tray(icon);
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '📝 写日志',
      click: () => {
        createLogWindow();
        petWindow?.webContents.send('pet-action', 'write');
      }
    },
    {
      label: '📋 查看日志',
      click: () => {
        createLogWindow();
        setTimeout(() => logWindow?.webContents.send('show-logs'), 500);
      }
    },
    { type: 'separator' },
    {
      label: settings.enabled ? '🔔 提醒已开启' : '🔕 提醒已关闭',
      click: () => {
        settings.enabled = !settings.enabled;
        saveSettings(settings);
        updateReminder();
        createTray();
      }
    },
    {
      label: '⚙️ 设置',
      click: () => {
        petWindow?.webContents.send('open-settings');
      }
    },
    { type: 'separator' },
    {
      label: '🌊 显示宠物',
      click: () => {
        if (!petWindow) createPetWindow();
        petWindow?.show();
      }
    },
    {
      label: '❌ 退出',
      click: () => {
        app.quit();
      }
    }
  ]);
  tray.setToolTip('夏日宠物 - 日志提醒助手');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    if (!petWindow) createPetWindow();
    petWindow?.show();
  });
}

function sendReminder() {
  if (!settings.enabled) return;

  const now = new Date();
  const hour = now.getHours();

  let message = '';
  if (hour >= 6 && hour < 12) {
    message = '早上好！来记录一下今天的心情吧 🌅';
  } else if (hour >= 12 && hour < 14) {
    message = '午休时间！记得记录上午的工作日志 📝';
  } else if (hour >= 14 && hour < 18) {
    message = '下午好！趁现在记录下下午的收获 ☀️';
  } else if (hour >= 18 && hour < 22) {
    message = '晚上好！来总结一下今天的一天吧 🌙';
  } else {
    message = '夜深了，记录一下今天最后的心情吧 🌊';
  }

  if (Notification.isSupported()) {
    new Notification({
      title: '夏日宠物提醒',
      body: message,
      icon: path.join(__dirname, 'assets', 'tray.png')
    }).show();
  }

  petWindow?.webContents.send('pet-reminder', message);
}

function updateReminder() {
  if (reminderTimer) {
    clearInterval(reminderTimer);
    reminderTimer = null;
  }
  if (settings.enabled) {
    const interval = (settings.reminderInterval || 60) * 60 * 1000;
    reminderTimer = setInterval(sendReminder, interval);
  }
}

ipcMain.handle('get-logs', () => loadLogs());

ipcMain.handle('save-log', (event, log) => {
  const logs = loadLogs();
  logs.unshift({
    id: Date.now(),
    date: new Date().toISOString(),
    content: log.content,
    mood: log.mood,
    tags: log.tags || []
  });
  saveLogs(logs);
  return true;
});

ipcMain.handle('delete-log', (event, id) => {
  const logs = loadLogs().filter(l => l.id !== id);
  saveLogs(logs);
  return true;
});

ipcMain.handle('get-settings', () => settings);

ipcMain.handle('save-settings', (event, newSettings) => {
  settings = { ...settings, ...newSettings };
  saveSettings(settings);
  updateReminder();
  return settings;
});

ipcMain.handle('open-log-window', () => {
  createLogWindow();
});

ipcMain.handle('pet-action', (event, action) => {
  petWindow?.webContents.send('pet-action', action);
});

ipcMain.handle('quit', () => {
  app.quit();
});

ipcMain.handle('hide-pet', () => {
  petWindow?.hide();
});

app.whenReady().then(() => {
  createPetWindow();
  createTray();
  updateReminder();
});

app.on('window-all-closed', () => {
  // Keep running in tray
});

app.on('activate', () => {
  if (!petWindow) createPetWindow();
});
