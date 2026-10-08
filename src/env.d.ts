/** Injected by Vite from package.json at build time. */
declare const __APP_VERSION__: string;

/** Provided by the desktop app's preload script (electron/preload.cjs); absent in a normal browser. */
interface DesktopUpdateResult {
  status: 'up-to-date' | 'ready' | 'needs-installer' | 'disabled' | 'busy' | 'error';
  version: string;
  notes?: string;
  url?: string;
  code?: string;
  message?: string;
  hint?: string;
}

interface Window {
  desktop?: {
    info(): Promise<{ enabled: boolean; version: string; updated: boolean; hasToken: boolean; ready: DesktopUpdateResult | null }>;
    checkForUpdates(): Promise<DesktopUpdateResult>;
    restart(): Promise<void>;
    useTokenFromClipboard(): Promise<{ ok: boolean; message: string }>;
  };
}
