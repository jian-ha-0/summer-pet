# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Install dependencies
npm install

# Run the app in development
npm start

# Build distributable (electron-builder, outputs to dist/)
npm run build
```

## Architecture

This is an Electron desktop pet application. The app creates a frameless, transparent, always-on-top window that displays an animated dolphin character, plus a separate log/diary window.

### Window Model

- **Pet window** (`pet.html`): 200x260 frameless transparent window. Handles all pet animations (CSS keyframes for floating, tail wagging, blinking, waves), click/right-click interactions, idle chat bubbles, and a settings panel. Communicates with main via `ipcRenderer`.
- **Log window** (`log.html`): 520x680 normal window with tabs for writing logs and viewing history. Fetches/saves data via IPC.

### Data Flow

All data operations go through `main.js` IPC handlers:

| IPC Channel | Direction | Data |
|---|---|---|
| `get-logs` | renderer → main | Returns array of log objects from `logs.json` |
| `save-log` | renderer → main | Appends log to `logs.json` (id, date, content, mood, tags) |
| `delete-log` | renderer → main | Removes log by id |
| `get-settings` | renderer → main | Returns settings object |
| `save-settings` | renderer → main | Merges and saves settings, triggers reminder reschedule |
| `open-log-window` | renderer → main | Opens log window |
| `pet-action` | main → pet | Triggers pet bubble messages (e.g., "write") |
| `pet-reminder` | main → pet | Displays reminder bubble with action button |
| `open-settings` | main → pet | Opens settings panel in pet window |

### Data Persistence

Data lives in the OS user data directory (`app.getPath('userData')/summer-pet/`):

- `logs.json` — diary entries, each with `id`, `date` (ISO string), `content`, `mood` (enum key), `tags` (string array)
- `settings.json` — `reminderInterval` (minutes), `enabled` (boolean), `petPosition` ({x, y})

Logs are read on every IPC call (no in-memory cache). Settings are loaded once at startup into the `settings` variable and kept in sync via `saveSettings()`.

### Reminder System

`updateReminder()` manages a single `setInterval` timer. The interval is `reminderInterval * 60 * 1000` ms. `sendReminder()` selects a message based on the current hour (6-12 morning, 12-14 noon, 14-18 afternoon, 18-22 evening, else night) and sends it both as a system `Notification` and to the pet window via `pet-reminder`.

### Tray Icon

The tray icon is created from an inline SVG buffer using `nativeImage.createFromBuffer`. There is no external assets directory — all graphics are generated programmatically or drawn with CSS.

### Security Notes

Both renderer windows have `nodeIntegration: true` and `contextIsolation: false`. This is intentional for simplicity but means renderer scripts have full Node.js access. Be cautious when modifying IPC handlers or rendering user-generated content.
