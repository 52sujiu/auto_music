/// <reference types="vite/client" />

// Vite 的 import.meta.glob 需要这份类型引用才认。
declare interface ImportMeta {
  glob: (
    pattern: string | string[],
    options?: {
      query?: string;
      import?: string;
      eager?: boolean;
    },
  ) => Record<string, unknown>;
}
