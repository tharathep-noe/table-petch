import { ipcMain } from 'electron';
import { CH } from '@shared/channels';
import type {
  Change,
  ConnectionInput,
  LoadRowsRequest,
  PersistedSession,
  SavedQueryInput,
} from '@shared/types';
import * as store from './store';
import * as session from './sessionStore';
import * as history from './historyStore';
import * as savedQueries from './savedQueryStore';
import * as mgr from './db/manager';
import { getRoutineSource, listSchema } from './db/introspect';
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
  ipcMain.handle(CH.getRoutineSource, (_e, id: string, handle: string) =>
    getRoutineSource(id, handle),
  );
  ipcMain.handle(CH.loadRows, (_e, req: LoadRowsRequest) => loadRows(req));
  ipcMain.handle(CH.runQuery, (_e, id: string, sql: string) =>
    runQuery(id, sql),
  );

  ipcMain.handle(CH.prepareChanges, (_e, id: string, changes: Change[]) =>
    prepareChanges(id, changes),
  );
  ipcMain.handle(CH.commitChanges, (_e, id: string, changes: Change[]) =>
    commitChanges(id, changes),
  );

  ipcMain.handle(CH.loadSession, () => session.loadSession());
  ipcMain.handle(CH.saveSession, (_e, s: PersistedSession) =>
    session.saveSession(s),
  );

  ipcMain.handle(CH.listHistory, (_e, id: string) => history.list(id));
  ipcMain.handle(CH.clearHistory, (_e, id: string) => history.clear(id));
  ipcMain.handle(CH.clearAllHistory, () => history.clearAll());

  ipcMain.handle(CH.listSavedQueries, () => savedQueries.list());
  ipcMain.handle(CH.saveQuery, (_e, input: SavedQueryInput) =>
    savedQueries.saveQuery(input),
  );
  ipcMain.handle(CH.deleteSavedQuery, (_e, id: string) =>
    savedQueries.deleteQuery(id),
  );
}
