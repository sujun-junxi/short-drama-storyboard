#!/usr/bin/env bash
# 手工打包 Windows 桌面应用（不依赖 electron-builder 的在线资源下载）。
#
# 原理：Electron 启动时会优先加载 <runtime>/resources/app 目录，
# 所以我们只需把 Electron 运行时复制一份，再把应用代码放进 resources/app，
# 最后把 electron.exe 改名即可。无需 nsis / winCodeSign，也就不用联网。
#
# 采用「覆盖式更新」而非整体删除：整体 rm -rf 会命中批量删除保护（几百个文件），
# 这里只删除我们自己的少量源码目录，运行时文件与依赖保持原地覆盖。
#
# 用法：bash scripts/package-desktop.sh
set -euo pipefail

cd "$(dirname "$0")/.."

OUT="release/ShortDramaStoryboard-win32-x64"
APP="$OUT/resources/app"

echo "[1/5] 准备输出目录"
mkdir -p "$APP"

echo "[2/5] 覆盖 Electron 运行时"
cp -r node_modules/electron/dist/. "$OUT/"
# default_app.asar 是 Electron 自带的空壳应用：只要 resources/app 存在，它就永远不会被加载。
# 某些环境的回收站不可用会让删除被拒（safe-delete 是 fail-closed 的），
# 而 set -e 会因此中断整个打包 —— 所以这里容错，不让一个无关紧要的文件挡住流程。
rm -f "$OUT/resources/default_app.asar" 2>/dev/null || echo "  · default_app.asar 未能删除，不影响运行（有 resources/app 时它不会被加载）"

echo "[3/5] 覆盖应用代码（只删自有源码目录，文件数很少）"
rm -rf "$APP/dist" "$APP/server" "$APP/shared" "$APP/electron" "$APP/.env" "$APP/.env.local"
cp -r dist server shared electron "$APP/"
# 不再打包 .env / .env.local：桌面端配置走界面「设置」，存在 userData/config.json。
# 若确实想给桌面包预置一份默认值，再手动把 .env 放进 resources/app。

echo "[4/5] 安装运行期依赖"
node -e "
const fs=require('fs');
const src=JSON.parse(fs.readFileSync('package.json','utf8'));
const out={
  name:'short-drama-storyboard',
  version:src.version,
  description:src.description,
  main:'electron/main.cjs',
  private:true,
  dependencies:{express:src.dependencies.express, dotenv:src.dependencies.dotenv}
};
fs.writeFileSync('$APP/package.json', JSON.stringify(out,null,2)+'\n');
"
(cd "$APP" && npm install --omit=dev --no-audit --no-fund --loglevel=error)

echo "[5/5] 重命名可执行文件"
if [ -f "$OUT/electron.exe" ]; then
  mv -f "$OUT/electron.exe" "$OUT/ShortDramaStoryboard.exe"
fi

echo ""
echo "===== 完成 ====="
echo "产物目录: $OUT"
echo "双击运行: $OUT/ShortDramaStoryboard.exe"
du -sh "$OUT"
