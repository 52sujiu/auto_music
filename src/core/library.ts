// 曲目库：内置于 public/midi/ 的曲目清单。
//
// 用 Vite 的 glob 把文件在构建时收集进来 —— 加一个文件就自动出现在列表里，
// 不用改这份清单。

export interface LibraryEntry {
  /** 显示名（去掉扩展名）。 */
  title: string;
  /** 作曲家（从文件名前缀取，没有就是空）。 */
  composer: string;
  /** 文件名。 */
  file: string;
  /** 供 fetch 的路径。 */
  url: string;
}

/** Vite 在构建时收集 public/midi 下的全部 .mid。 */
const modules = import.meta.glob("/public/midi/*.mid", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** 从文件名解析出作曲家与曲名。 */
function parseName(file: string): { title: string; composer: string } {
  const base = file.replace(/\.mid$/i, "");
  const dash = base.indexOf("-");
  if (dash > 0) {
    return { composer: base.slice(0, dash), title: base.slice(dash + 1) };
  }
  return { title: base, composer: "" };
}

/** 全部曲目，按作曲家分组后排序。 */
export const LIBRARY: LibraryEntry[] = Object.keys(modules)
  .map((path) => {
    const file = path.split("/").pop()!;
    const { title, composer } = parseName(file);
    return {
      title,
      composer,
      file,
      // 用 /midi/<文件名> 取，Vite 会从 public 直接提供
      url: `/midi/${encodeURIComponent(file)}`,
    };
  })
  .sort((a, b) => {
    if (a.composer !== b.composer)
      return a.composer.localeCompare(b.composer, "zh");
    return a.title.localeCompare(b.title, "zh");
  });

/** 按作曲家分组。 */
export function groupByComposer(): Array<{
  composer: string;
  items: LibraryEntry[];
}> {
  const map = new Map<string, LibraryEntry[]>();
  for (const e of LIBRARY) {
    const key = e.composer || "其他";
    const list = map.get(key);
    if (list) list.push(e);
    else map.set(key, [e]);
  }
  return [...map.entries()].map(([composer, items]) => ({ composer, items }));
}

/** 读一个内置曲目为 ArrayBuffer。
 *
 * 只接受构建时由 import.meta.glob 生成的条目 —— url 取自文件名字面量，
 * 不是用户输入。这里再校验一次路径形状，避免将来有人把任意 url 传进来。
 */
export async function loadLibraryEntry(
  entry: LibraryEntry,
): Promise<ArrayBuffer> {
  if (!entry.file || entry.file.includes("/") || entry.file.includes("..")) {
    throw new Error(`非法曲目文件名：${entry.file}`);
  }
  const url = `/midi/${encodeURIComponent(entry.file)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`读取失败：${res.status} ${res.statusText}`);
  return res.arrayBuffer();
}
