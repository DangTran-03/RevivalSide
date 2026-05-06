const fs = require("fs");
const path = require("path");

function loadPacketHandlers(handlerRoots, options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const handlers = new Map();
  const handlerFiles = collectPacketHandlerFiles(handlerRoots, rootDir);

  for (const filePath of handlerFiles) {
    const fileName = path.relative(rootDir, filePath);
    try {
      const exported = require(filePath);
      const fileHandlers = Array.isArray(exported)
        ? exported
        : Array.isArray(exported.handlers)
          ? exported.handlers
          : [exported];
      for (const handler of fileHandlers) {
        if (typeof handler.packetId !== "number" || typeof handler.handle !== "function") {
          console.log(`[handlers] skip ${fileName}; missing packetId/handle`);
          continue;
        }
        if (handlers.has(handler.packetId)) {
          console.log(`[handlers] duplicate packetId=${handler.packetId}; ${fileName} ignored`);
          continue;
        }
        handlers.set(handler.packetId, { ...handler, fileName });
      }
    } catch (err) {
      console.log(`[handlers] failed to load ${fileName}: ${err.message}`);
    }
  }

  console.log(`[handlers] loaded ${handlers.size} packet handlers from ${handlerFiles.length} files`);
  return handlers;
}

function collectPacketHandlerFiles(handlerRoots, rootDir) {
  const roots = Array.isArray(handlerRoots) ? handlerRoots : [handlerRoots];
  const files = [];
  for (const root of roots) {
    if (!root || !fs.existsSync(root)) {
      console.log(`[handlers] no packet handler directory at ${root}`);
      continue;
    }
    collectPacketHandlerFilesFrom(root, files);
  }
  return files.sort((left, right) => compareHandlerFilePaths(left, right, rootDir));
}

function collectPacketHandlerFilesFrom(target, files) {
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    if (target.endsWith(".js")) files.push(target);
    return;
  }
  if (!stat.isDirectory()) return;

  const baseName = path.basename(target).toLowerCase();
  if (baseName === "handlers" || baseName === "packet-handlers") {
    for (const entry of fs.readdirSync(target).filter((file) => file.endsWith(".js")).sort()) {
      files.push(path.join(target, entry));
    }
    return;
  }

  for (const entry of fs.readdirSync(target).sort()) {
    const child = path.join(target, entry);
    if (fs.statSync(child).isDirectory()) collectPacketHandlerFilesFrom(child, files);
  }
}

function compareHandlerFilePaths(left, right, rootDir) {
  const leftName = path.basename(left);
  const rightName = path.basename(right);
  if (leftName < rightName) return -1;
  if (leftName > rightName) return 1;

  const leftPath = path.relative(rootDir, left);
  const rightPath = path.relative(rootDir, right);
  if (leftPath < rightPath) return -1;
  if (leftPath > rightPath) return 1;
  return 0;
}

module.exports = {
  loadPacketHandlers,
};
