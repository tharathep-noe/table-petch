import type { TablePetchApi } from '@shared/types';

declare global {
  interface Window {
    api: TablePetchApi;
  }
}

export {};
