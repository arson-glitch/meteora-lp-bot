import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { LiveBook, PaperBook } from "../types.js";

export interface BookStore<T> {
  load(): T;
  save(book: T): void;
}

export function emptyPaperBook(nowMs = Date.now()): PaperBook {
  return { version: 1, mode: "paper", updatedAt: new Date(nowMs).toISOString(), positions: [], events: [] };
}

export function emptyLiveBook(nowMs = Date.now()): LiveBook {
  return { version: 1, mode: "live", updatedAt: new Date(nowMs).toISOString(), positions: [] };
}

export class FileBookStore<T> implements BookStore<T> {
  constructor(
    private readonly path: string,
    private readonly empty: () => T,
  ) {}

  load(): T {
    if (!existsSync(this.path)) return this.empty();
    return JSON.parse(readFileSync(this.path, "utf8")) as T;
  }

  save(book: T): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${JSON.stringify(book, null, 2)}\n`);
  }
}

export class MemoryBookStore<T> implements BookStore<T> {
  constructor(public book: T) {}

  load(): T {
    return this.book;
  }

  save(book: T): void {
    this.book = book;
  }
}
