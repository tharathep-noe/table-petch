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
  commitChanges: 'db:commit'
} as const

export type Channel = (typeof CH)[keyof typeof CH]
