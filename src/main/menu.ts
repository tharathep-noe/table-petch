import {
  app,
  Menu,
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from 'electron';
import { CH } from '@shared/channels';

// A custom application menu. Installing one replaces Electron's default, so we
// must re-declare the standard roles (Edit/copy-paste, Window, …) or the user
// loses them. The reason for owning the menu at all is Tab shortcuts: on macOS
// `Cmd+W` is the native "close window" accelerator and can't be intercepted from
// a renderer keydown, so `Close Tab` / `New Tab` are menu items that push a
// one-way intent to the renderer, which owns tab state. See ADR 0005.
export function installAppMenu(win: BrowserWindow): void {
  const isMac = process.platform === 'darwin';

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const, label: app.name }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+T',
          click: () => win.webContents.send(CH.menuNewTab),
        },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => win.webContents.send(CH.menuCloseTab),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
