// IPC channel names. Keep in sync with TablePetchApi methods.
export const CH = {
  listConnections: 'conn:list',
  saveConnection: 'conn:save',
  deleteConnection: 'conn:delete',
  testConnection: 'conn:test',
  connect: 'db:connect',
  disconnect: 'db:disconnect',
  switchDatabase: 'db:switch',
  listSchema: 'db:schema',
  loadRows: 'db:loadRows',
  runQuery: 'db:runQuery',
  prepareChanges: 'db:prepare',
  commitChanges: 'db:commit',
  loadSession: 'session:load',
  saveSession: 'session:save',
  listHistory: 'history:list',
  clearHistory: 'history:clear',
  clearAllHistory: 'history:clearAll',
  listSavedQueries: 'savedQuery:list',
  saveQuery: 'savedQuery:save',
  deleteSavedQuery: 'savedQuery:delete',
} as const;

export type Channel = (typeof CH)[keyof typeof CH];
