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
  getRoutineSource: 'db:routineSource',
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
  // One-way pushes from the application menu (main → renderer). See ADR 0005.
  menuNewTab: 'menu:newTab',
  menuCloseTab: 'menu:closeTab',
} as const;

export type Channel = (typeof CH)[keyof typeof CH];
