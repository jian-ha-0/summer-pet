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
let alarmWindow;
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

function getLocalDateString(date) {
  const d = date || new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function createAlarmWindow(plan) {
  if (alarmWindow) {
    alarmWindow.focus();
    return;
  }

  alarmWindow = new BrowserWindow({
    width: 440,
    height: 400,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: false,
    center: true,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  alarmWindow.loadFile(path.join(__dirname, 'alarm.html'));

  alarmWindow.once('ready-to-show', () => {
    alarmWindow.show();
    alarmWindow.flashFrame(true);
    alarmWindow.webContents.send('alarm-data', {
      time: plan.time,
      content: plan.content
    });
  });

  alarmWindow.on('closed', () => {
    alarmWindow = null;
  });
}

function checkPlanReminders() {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentSecond = now.getSeconds();

  // 只在每分钟的 0~55 秒范围内触发，避免在分钟切换边界处重复触发
  const today = getLocalDateString(now);

  const plans = loadPlans();

  plans.forEach(plan => {
    if (plan.completed) return;
    if (!plan.time) return;

    const [h, m] = plan.time.split(':').map(Number);

    // 时间匹配：当前时分等于计划时分
    if (h !== currentHour || m !== currentMinute) return;

    // 日期匹配：如果是特定日期计划，检查是否今天
    if (plan.date && plan.date !== today) return;

    // 检查今天是否已经提醒过（用 plan.id + 日期作为唯一键）
    const notifyKey = `${plan.id}-${today}`;
    if (lastNotifiedPlans.has(notifyKey)) return;

    // 记录已提醒
    lastNotifiedPlans.add(notifyKey);

    const message = plan.date
      ? `⏰ 计划提醒：${plan.time} ${plan.content}`
      : `⏰ 每日提醒：${plan.time} ${plan.content}`;

    // 1. 系统通知栏提示（辅助）
    if (Notification.isSupported()) {
      new Notification({
        title: '⏰ 计划时间到啦！',
        body: plan.content,
        silent: false
      }).show();
    }

    // 2. 宠物气泡消息
    petWindow?.webContents.send('plan-reminder', message);

    // 3. 闹钟弹窗（主要提醒方式，有声音、需手动关闭）
    createAlarmWindow(plan);
  });

  // 每天凌晨清理过期的通知记录
  if (currentHour === 0 && currentMinute === 0 && currentSecond < 10) {
    lastNotifiedPlans.clear();
  }

  // 限制内存占用（保留最近100条）
  if (lastNotifiedPlans.size > 100) {
    const arr = Array.from(lastNotifiedPlans);
    lastNotifiedPlans = new Set(arr.slice(-60));
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
  planCheckTimer = setInterval(checkPlanReminders, 5000); // 每5秒检查一次
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

ipcMain.on('close-alarm', () => {
  if (alarmWindow) {
    alarmWindow.close();
    alarmWindow = null;
  }
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
