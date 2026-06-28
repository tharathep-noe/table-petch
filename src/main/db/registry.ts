// Engine → Driver resolution. Each driver module is dynamically imported only
// when the first connection of that engine opens (ADR 0006: bundle all,
// lazy-load on first use), then cached.

import type { Engine } from '@shared/types';
import type { Driver } from './driver';

const loaders: Record<Engine, () => Promise<Driver>> = {
  postgres: async () => (await import('./drivers/postgres')).postgresDriver,
  mysql: async () => (await import('./drivers/mysql')).mysqlDriver,
  mssql: notYet('MSSQL'),
  oracle: notYet('Oracle'),
};

function notYet(label: string): () => Promise<Driver> {
  return () =>
    Promise.reject(new Error(`${label} support is not implemented yet.`));
}

const cache = new Map<Engine, Driver>();

export async function getDriver(engine: Engine): Promise<Driver> {
  const cached = cache.get(engine);
  if (cached) return cached;
  const driver = await loaders[engine]();
  cache.set(engine, driver);
  return driver;
}
