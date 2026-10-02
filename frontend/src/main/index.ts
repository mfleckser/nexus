import { app, shell, BrowserWindow, ipcMain, screen } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import { apiRequest } from "./client";

// Test-only: NEXUS_HIDDEN=1 keeps the window off-screen and out of the Dock so
// automated (Playwright) runs don't steal focus. Hidden windows still render.
const hidden = process.env["NEXUS_HIDDEN"] === "1";

// Protocols links may hand off to the OS.
const EXTERNAL_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);

function openExternalSafely(url: string): void {
    let protocol: string;
    try {
        protocol = new URL(url).protocol;
    } catch {
        return;
    }
    if (EXTERNAL_PROTOCOLS.has(protocol)) shell.openExternal(url).catch(console.error);
}

// Same document, ignoring hash/query (the renderer uses a HashRouter).
function isSameDocument(a: string, b: string): boolean {
    try {
        const ua = new URL(a);
        const ub = new URL(b);
        return ua.protocol === ub.protocol && ua.host === ub.host && ua.pathname === ub.pathname;
    } catch {
        return false;
    }
}

function createWindow(): void {
    // Create the browser window.
    const mainWindow = new BrowserWindow({
        width: 900,
        height: 670,
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
            preload: join(__dirname, "../preload/index.js"),
            sandbox: true,
        },
    });

    mainWindow.on("ready-to-show", () => {
        if (hidden) {
            // maximize() would show the window, so size it to the work area instead.
            const { width, height } = screen.getPrimaryDisplay().workAreaSize;
            mainWindow.setSize(width, height);
            return;
        }
        mainWindow.maximize();
        mainWindow.show();
    });

    mainWindow.on("focus", () => {
        mainWindow.webContents.send("window-focus");
    });

    mainWindow.webContents.setWindowOpenHandler((details) => {
        openExternalSafely(details.url);
        return { action: "deny" };
    });

    // The window only ever shows the app; links elsewhere open in the browser.
    mainWindow.webContents.on("will-navigate", (e, url) => {
        if (isSameDocument(url, mainWindow.webContents.getURL())) return;
        e.preventDefault();
        openExternalSafely(url);
    });

    // HMR for renderer base on electron-vite cli.
    // Load the remote URL for development or the local html file for production.
    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
        mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    } else {
        mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
    }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
    // Set app user model id for windows (matches electron-builder appId)
    electronApp.setAppUserModelId("com.markfleckser.nexus");

    if (hidden) app.dock?.hide();

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
    app.on("browser-window-created", (_, window) => {
        optimizer.watchWindowShortcuts(window);
    });

    ipcMain.handle("apiGet", (_, path: unknown) => apiRequest("get", path));
    ipcMain.handle("apiPost", (_, path: unknown, body: unknown) => apiRequest("post", path, body));
    ipcMain.handle("apiPut", (_, path: unknown, body: unknown) => apiRequest("put", path, body));
    ipcMain.handle("apiDelete", (_, path: unknown) => apiRequest("delete", path));

    createWindow();

    app.on("activate", function () {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
