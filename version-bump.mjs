import { readFileSync, writeFileSync } from "fs";

// 通过 `npm version <new-version>` 触发：读取目标版本号
const targetVersion = process.env.npm_package_version;

// 1) 读取 manifest.json 中的 minAppVersion，并把 manifest 的 version 更新为目标版本
let manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t"));

// 2) 在 versions.json 中追加「目标版本 -> minAppVersion」的映射，
//    供 Obsidian 社区插件市场判断更新
let versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, "\t"));
