import { app, BrowserWindow, ipcMain } from "electron";
import net from "node:net";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// Recreate __filename and __dirname for ES module scope
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve renderer and public assets from the application root in both modes.
const DIST_PATH = path.join(__dirname, "../../dist");
const PUBLIC_PATH = path.join(__dirname, "../../public");

// Set environment variables for use throughout the app
process.env.DIST = DIST_PATH;
process.env.PUBLIC = PUBLIC_PATH;
process.env.VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || "";
process.env.NODE_ENV = process.env.NODE_ENV || "production";

let win: BrowserWindow | null = null;
const VITE_DEV_SERVER_URL = app.isPackaged
  ? ""
  : process.env.VITE_DEV_SERVER_URL;

function createWindow() {
  // Determine icon path based on platform
  const iconPath = path.join(
    PUBLIC_PATH,
    process.platform === "win32" ? "favicon.ico" : "icon.png",
  );

  // Create the browser window
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  });

  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, targetUrl) => {
    const allowed = app.isPackaged
      ? targetUrl.startsWith("file:")
      : Boolean(VITE_DEV_SERVER_URL && targetUrl.startsWith(VITE_DEV_SERVER_URL));
    if (!allowed) event.preventDefault();
  });

  // Hide menu bar for cleaner look
  win.setMenuBarVisibility(false);
  win.setMenu(null);

  if (!app.isPackaged) {
    win.webContents.openDevTools({ mode: "detach" });
  }

  // Load the app
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    try {
      const indexPath = path.join(DIST_PATH, "index.html");
      console.log("Loading index.html from:", indexPath);

      if (fs.existsSync(indexPath)) {
        win.loadFile(indexPath);
      } else {
        console.error("index.html not found at:", indexPath);
      }
    } catch (error) {
      console.error("Error loading index.html:", error);
    }
  }
}

ipcMain.handle("printing:get-printers", async () => {
  if (!win || win.isDestroyed()) return [];
  const printers = await win.webContents.getPrintersAsync();
  return printers.map((printer) => ({
    name: printer.name,
    displayName: printer.displayName,
    description: printer.description,
  }));
});

ipcMain.handle("printing:print-page", async (_event, requestedPrinter?: unknown) => {
  if (!win || win.isDestroyed()) throw new Error("The POS window is unavailable.");
  const printerName = typeof requestedPrinter === "string" ? requestedPrinter : "";
  if (printerName) {
    const printers = await win.webContents.getPrintersAsync();
    if (!printers.some((printer) => printer.name === printerName)) {
      throw new Error("The selected printer is no longer installed.");
    }
  }

  return new Promise<{ success: boolean; error?: string }>((resolve) => {
    win!.webContents.print(
      {
        silent: Boolean(printerName),
        printBackground: true,
        deviceName: printerName || undefined,
        margins: { marginType: "none" },
      },
      (success, failureReason) =>
        resolve({ success, error: success ? undefined : failureReason }),
    );
  });
});

function isLocalPrinterAddress(host: unknown): host is string {
  if (typeof host !== "string" || !net.isIPv4(host)) return false;
  const [a, b] = host.split(".").map(Number);
  return a === 10 || a === 127 || a === 192 && b === 168 ||
    a === 172 && b >= 16 && b <= 31 || a === 169 && b === 254;
}

ipcMain.handle(
  "printing:send-network-receipt",
  async (_event, host: unknown, port: unknown, rawData: unknown) => {
    if (!isLocalPrinterAddress(host)) {
      throw new Error("Enter a printer IPv4 address on the local network.");
    }
    if (typeof port !== "number" || !Number.isInteger(port) || port !== 9100) {
      throw new Error("Raw ESC/POS printing is limited to the standard printer port 9100.");
    }
    if (!(rawData instanceof Uint8Array) || rawData.byteLength < 1 || rawData.byteLength > 256_000) {
      throw new Error("Receipt data is invalid or too large.");
    }

    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host, port: Number(port) });
      socket.setTimeout(8_000);
      socket.once("connect", () => socket.end(Buffer.from(rawData)));
      socket.once("close", (hadError) => {
        if (hadError) reject(new Error("The printer connection closed unexpectedly."));
        else resolve();
      });
      socket.once("timeout", () => socket.destroy(new Error("Printer connection timed out.")));
      socket.once("error", (error) => reject(new Error(`Could not send receipt: ${error.message}`)));
    });
    return { success: true };
  },
);

// App event handlers
app.on("window-all-closed", () => {
  win = null;
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.whenReady().then(() => {
  createWindow();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
