const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

function createWindow() {
    // 本番判定（これが一番確実）
    const isDev = !app.isPackaged;

    // 本番ではメニュー削除
    if (!isDev) {
        Menu.setApplicationMenu(null);
    }

    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        title: "ウゴメキ",
        icon: path.join(__dirname, "../public/icon.png"),

        // Altキーでも出ない
        autoHideMenuBar: !isDev,

        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        }
    });

    // 念押し（Windows対策）
    if (!isDev) {
        win.setMenuBarVisibility(false);
        win.removeMenu(); // Electron v14以降推奨
    }

    // 開発サーバー or dist
    if (isDev && process.env.VITE_DEV_SERVER_URL) {
        win.loadURL(process.env.VITE_DEV_SERVER_URL);
    } else {
        win.loadFile(path.join(__dirname, "../dist/index.html"));
    }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
