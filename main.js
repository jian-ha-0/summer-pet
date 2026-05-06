const { app, BrowserWindow, ipcMain, Tray, Menu, Notification, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(app.getPath('userData'), 'summer-pet');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');
const PLANS_FILE = path.join(DATA_DIR, 'plans.json');
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

function loadPlans() {
  try {
    return JSON.parse(fs.readFileSync(PLANS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function savePlans(plans) {
  fs.writeFileSync(PLANS_FILE, JSON.stringify(plans, null, 2));
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
let planWindow;
let splashWindow;
let tray;
let reminderTimer;
let planCheckTimer;
let settings = loadSettings();
let lastNotifiedPlans = new Set();

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    center: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  splashWindow.loadFile(path.join(__dirname, 'splash.html'));

  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

function createPetWindow() {
  const { width: screenW, height: screenH } = require('electron').screen.getPrimaryDisplay().workAreaSize;
  const x = settings.petPosition.x || screenW - 260;
  const y = settings.petPosition.y || screenH - 360;

  petWindow = new BrowserWindow({
    width: 280,
    height: 420,
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
    height: 700,
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

function createPlanWindow() {
  if (planWindow) {
    planWindow.focus();
    return;
  }

  planWindow = new BrowserWindow({
    width: 520,
    height: 700,
    title: '工作计划',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  planWindow.loadFile(path.join(__dirname, 'plan.html'));

  planWindow.on('closed', () => {
    planWindow = null;
  });
}

function createTrayIcon() {
  const svgBuffer = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
    <rect width="32" height="32" rx="4" fill="#4FC3F7"/>
    <circle cx="16" cy="16" r="10" fill="#FFD54F"/>
    <circle cx="12" cy="14" r="2" fill="#333"/>
    <circle cx="20" cy="14" r="2" fill="#333"/>
    <path d="M12 22 Q16 25 20 22" stroke="#333" stroke-width="1.5" fill="none"/>
  </svg>`);
  return nativeImage.createFromBuffer(svgBuffer, { scaleFactor: 1 });
}

function createTray() {
  if (tray) tray.destroy();
  const icon = createTrayIcon();

  tray = new Tray(icon);
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '✅ 工作计划',
      click: () => {
        createPlanWindow();
      }
    },
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

function checkPlanReminders() {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const timeKey = `${currentHour}:${String(currentMinute).padStart(2, '0')}`;

  const plans = loadPlans();
  const today = now.toISOString().split('T')[0];

  const duePlans = plans.filter(p => {
    if (p.completed) return false;
    if (!p.time) return false;
    const [h, m] = p.time.split(':').map(Number);
    const planTime = `${h}:${String(m).padStart(2, '0')}`;
    if (planTime !== timeKey) return false;
    if (p.date && p.date !== today) return false;
    return true;
  });

  duePlans.forEach(plan => {
    const notifyKey = `${plan.id}-${timeKey}`;
    if (lastNotifiedPlans.has(notifyKey)) return;
    lastNotifiedPlans.add(notifyKey);

    const message = plan.date
      ? `⏰ 计划提醒：${plan.time} ${plan.content}`
      : `⏰ 每日提醒：${plan.time} ${plan.content}`;

    if (Notification.isSupported()) {
      new Notification({
        title: '计划提醒',
        body: plan.content,
        icon: path.join(__dirname, 'assets', 'tray.png')
      }).show();
    }

    petWindow?.webContents.send('plan-reminder', message);
  });

  // 清理过期的通知记录（保留最近60条）
  if (lastNotifiedPlans.size > 60) {
    const arr = Array.from(lastNotifiedPlans);
    lastNotifiedPlans = new Set(arr.slice(-40));
  }
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

function startPlanChecker() {
  if (planCheckTimer) clearInterval(planCheckTimer);
  planCheckTimer = setInterval(checkPlanReminders, 30000); // 每30秒检查一次
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

ipcMain.handle('get-plans', () => loadPlans());

ipcMain.handle('save-plan', (event, plan) => {
  const plans = loadPlans();
  plans.push({
    id: Date.now(),
    content: plan.content,
    time: plan.time,
    date: plan.date || null,
    completed: false,
    createdAt: new Date().toISOString()
  });
  savePlans(plans);
  return true;
});

ipcMain.handle('delete-plan', (event, id) => {
  const plans = loadPlans().filter(p => p.id !== id);
  savePlans(plans);
  return true;
});

ipcMain.handle('toggle-plan', (event, id) => {
  const plans = loadPlans();
  const plan = plans.find(p => p.id === id);
  if (plan) {
    plan.completed = !plan.completed;
    savePlans(plans);
  }
  return plan?.completed || false;
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

ipcMain.handle('open-plan-window', () => {
  createPlanWindow();
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

ipcMain.handle('move-window', (event, dx, dy) => {
  if (!petWindow) return;
  const [x, y] = petWindow.getPosition();
  petWindow.setPosition(Math.round(x + dx), Math.round(y + dy));
});

app.whenReady().then(() => {
  createSplashWindow();

  setTimeout(() => {
    if (splashWindow) {
      splashWindow.close();
      splashWindow = null;
    }
    createPetWindow();
    createTray();
    updateReminder();
    startPlanChecker();
  }, 2500);
});

app.on('window-all-closed', () => {
  // Keep running in tray
});

app.on('activate', () => {
  if (!petWindow) createPetWindow();
});
