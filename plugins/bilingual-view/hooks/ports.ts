import type { HttpInit, HttpResponse } from 'claude-code';

/** Host calls are bound in register.ts so Claude's static validator can see them. */
export type StorageIO = {
  cacheFiles: {
    read(path: string): Promise<string>;
    write(path: string, text: string): Promise<void>;
    exists(path: string): Promise<boolean>;
  };
  toast(text: string): void | Promise<void>;
};

export type TranslationIO = {
  env: {
    baseUrl(): Promise<string | undefined>;
    model(): Promise<string | undefined>;
    apiKey(): Promise<string | undefined>;
  };
  fetch(url: string, init: HttpInit): Promise<HttpResponse>;
};

export type RuntimeIO = StorageIO & TranslationIO & {
  now(): Promise<number>;
  invalidate(): void;
  after(ms: number, run: () => void | Promise<void>): void;
  history: {
    read(path: string): Promise<string>;
    stat(path: string): Promise<{ size: number; mtimeMs: number }>;
  };
};
