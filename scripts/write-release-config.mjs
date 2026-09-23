import { readFileSync, writeFileSync } from "node:fs";

const repository = process.env.GITHUB_REPOSITORY;
const tag = process.env.GITHUB_REF_NAME;
if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
  throw new Error("GITHUB_REPOSITORY 必须是 owner/repo");
}
if (!tag || !/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(tag)) {
  throw new Error("发布标签必须是 vX.Y.Z");
}

const version = tag.slice(1);
const packageVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
const tauriVersion = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).version;
const cargo = readFileSync("src-tauri/Cargo.toml", "utf8");
const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
if ([packageVersion, tauriVersion, cargoVersion].some((value) => value !== version)) {
  throw new Error(`标签 ${tag} 与版本不一致：npm=${packageVersion} Tauri=${tauriVersion} Cargo=${cargoVersion}`);
}

writeFileSync("src-tauri/tauri.release.conf.json", JSON.stringify({
  bundle: { createUpdaterArtifacts: true },
  plugins: {
    updater: {
      endpoints: [`https://github.com/${repository}/releases/latest/download/latest.json`],
    },
  },
}, null, 2) + "\n");
console.log(`更新源已配置为 GitHub Releases：${repository}`);
