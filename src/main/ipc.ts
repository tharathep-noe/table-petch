import { ipcMain } from 'electron';
import { CH } from '@shared/channels';
import type {
  Change,
  ConnectionInput,
  LoadRowsRequest,
  PersistedSession,
} from '@shared/types';
import * as store from './store';
import * as session from './sessionStore';
import * as mgr from './db/manager';
import { listSchema } from './db/introspect';
import { loadRows, runQuery } from './db/query';
import { commitChanges, prepareChanges } from './db/commit';

// Wire the RPC surface. Each handler maps 1:1 to a TablePetchApi method.
export function registerIpc(): void {
  ipcMain.handle(CH.listConnections, () => store.listConnections());
  ipcMain.handle(CH.saveConnection, (_e, input: ConnectionInput) =>
    store.saveConnection(input),
  );
  ipcMain.handle(CH.deleteConnection, (_e, id: string) =>
    store.deleteConnection(id),
  );
  ipcMain.handle(CH.testConnection, (_e, input: ConnectionInput) =>
    mgr.testConnection(input),
  );

  ipcMain.handle(CH.connect, (_e, id: string) => mgr.connect(id));
  ipcMain.handle(CH.disconnect, (_e, id: string) => mgr.disconnect(id));
  ipcMain.handle(CH.switchDatabase, (_e, id: string, database: string) =>
    mgr.connect(id, database),
  );

  ipcMain.handle(CH.listSchema, (_e, id: string) => listSchema(id));
  ipcMain.handle(CH.loadRows, (_e, req: LoadRowsRequest) => loadRows(req));
  ipcMain.handle(CH.runQuery, (_e, id: string, sql: string) =>
    runQuery(id, sql),
  );

  ipcMain.handle(CH.prepareChanges, (_e, _id: string, changes: Change[]) =>
    prepareChanges(changes),
  );
  ipcMain.handle(CH.commitChanges, (_e, id: string, changes: Change[]) =>
    commitChanges(id, changes),
  );

  ipcMain.handle(CH.loadSession, () => session.loadSession());
  ipcMain.handle(CH.saveSession, (_e, s: PersistedSession) =>
    session.saveSession(s),
  );
}
