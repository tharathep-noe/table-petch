import { contextBridge, ipcRenderer } from 'electron';
import { CH } from '@shared/channels';
import type {
  Change,
  ConnectionInput,
  LoadRowsRequest,
  PersistedSession,
  SavedQueryInput,
  TablePetchApi,
} from '@shared/types';

// The only surface the sandboxed renderer can touch. Mirrors TablePetchApi.
const api: TablePetchApi = {
  listConnections: () => ipcRenderer.invoke(CH.listConnections),
  saveConnection: (input: ConnectionInput) =>
    ipcRenderer.invoke(CH.saveConnection, input),
  deleteConnection: (id: string) => ipcRenderer.invoke(CH.deleteConnection, id),
  testConnection: (input: ConnectionInput) =>
    ipcRenderer.invoke(CH.testConnection, input),

  connect: (id: string) => ipcRenderer.invoke(CH.connect, id),
  disconnect: (id: string) => ipcRenderer.invoke(CH.disconnect, id),
  switchDatabase: (id: string, database: string) =>
    ipcRenderer.invoke(CH.switchDatabase, id, database),

  listSchema: (id: string) => ipcRenderer.invoke(CH.listSchema, id),
  getRoutineSource: (id: string, oid: number) =>
    ipcRenderer.invoke(CH.getRoutineSource, id, oid),
  loadRows: (req: LoadRowsRequest) => ipcRenderer.invoke(CH.loadRows, req),
  runQuery: (id: string, sql: string) =>
    ipcRenderer.invoke(CH.runQuery, id, sql),

  prepareChanges: (id: string, changes: Change[]) =>
    ipcRenderer.invoke(CH.prepareChanges, id, changes),
  commitChanges: (id: string, changes: Change[]) =>
    ipcRenderer.invoke(CH.commitChanges, id, changes),

  loadSession: () => ipcRenderer.invoke(CH.loadSession),
  saveSession: (session: PersistedSession) =>
    ipcRenderer.invoke(CH.saveSession, session),

  listHistory: (id: string) => ipcRenderer.invoke(CH.listHistory, id),
  clearHistory: (id: string) => ipcRenderer.invoke(CH.clearHistory, id),
  clearAllHistory: () => ipcRenderer.invoke(CH.clearAllHistory),

  listSavedQueries: () => ipcRenderer.invoke(CH.listSavedQueries),
  saveQuery: (input: SavedQueryInput) =>
    ipcRenderer.invoke(CH.saveQuery, input),
  deleteSavedQuery: (id: string) => ipcRenderer.invoke(CH.deleteSavedQuery, id),
};

contextBridge.exposeInMainWorld('api', api);
