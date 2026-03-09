/** Generic key-value store interface for prism-pipe persistence. */
export interface Store {
  init(): Promise<void>;
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  close(): Promise<void>;
}
