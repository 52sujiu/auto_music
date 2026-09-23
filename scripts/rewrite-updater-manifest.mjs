import { readFileSync, writeFileSync } from "node:fs";

const [manifestPath] = process.argv.slice(2);
const repository = process.env.GITHUB_REPOSITORY;
const tag = process.env.GITHUB_REF_NAME;
const token = process.env.GH_TOKEN;
if (!manifestPath || !repository || !tag || !token) {
  throw new Error("需要清单路径、GITHUB_REPOSITORY、GITHUB_REF_NAME 和 GH_TOKEN");
}

const response = await fetch(`https://api.github.com/repos/${repository}/releases/tags/${tag}`, {
  headers: {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  },
});
if (!response.ok) throw new Error(`读取 GitHub Release 失败：HTTP ${response.status}`);
const release = await response.json();
const assets = new Map(release.assets.map((asset) => [asset.id, asset]));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (`v${manifest.version}` !== tag) throw new Error("更新清单版本与标签不一致");

let rewritten = 0;
for (const platform of Object.values(manifest.platforms ?? {})) {
  const match = platform.url?.match(/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/releases\/assets\/(\d+)$/);
  if (!match) throw new Error(`无法识别的更新下载地址：${platform.url}`);
  const asset = assets.get(Number(match[1]));
  if (!asset?.browser_download_url || !platform.signature) {
    throw new Error(`更新附件或签名缺失：${platform.url}`);
  }
  platform.url = asset.browser_download_url;
  rewritten++;
}
if (rewritten === 0) throw new Error("更新清单没有平台信息");

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`已将 ${rewritten} 个更新地址改为公开下载链接`);
