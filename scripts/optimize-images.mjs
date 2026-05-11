import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const rootDir = path.resolve(import.meta.dirname, "..");
const imageDirs = ["ai", "human"].map((dir) => path.join(rootDir, "public", dir));
const sourceExtensions = new Set([".jpg", ".jpeg", ".png"]);
const maxSize = 1600;
const webpQuality = 82;

function isSourceImage(fileName) {
  return sourceExtensions.has(path.extname(fileName).toLowerCase());
}

function outputName(fileName) {
  return `${path.basename(fileName, path.extname(fileName))}.webp`;
}

async function uniqueOutputPath(directory, fileName, sourcePath) {
  const baseName = outputName(fileName);
  let candidate = path.join(directory, baseName);
  let suffix = 2;

  while (true) {
    try {
      const candidateStat = await stat(candidate);
      const sourceStat = await stat(sourcePath);

      if (candidateStat.dev === sourceStat.dev && candidateStat.ino === sourceStat.ino) {
        return candidate;
      }
    } catch {
      return candidate;
    }

    candidate = path.join(
      directory,
      `${path.basename(baseName, ".webp")}-${suffix}.webp`,
    );
    suffix += 1;
  }
}

let converted = 0;
let savedBytes = 0;

for (const directory of imageDirs) {
  await mkdir(directory, { recursive: true });
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !isSourceImage(entry.name)) {
      continue;
    }

    const sourcePath = path.join(directory, entry.name);
    const tempPath = `${sourcePath}.tmp.webp`;
    const targetPath = await uniqueOutputPath(directory, entry.name, sourcePath);
    const before = (await stat(sourcePath)).size;

    await sharp(sourcePath)
      .rotate()
      .resize({
        width: maxSize,
        height: maxSize,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: webpQuality, effort: 6 })
      .toFile(tempPath);

    await rm(sourcePath);
    await rename(tempPath, targetPath);

    const after = (await stat(targetPath)).size;
    converted += 1;
    savedBytes += before - after;
    console.log(`${path.relative(rootDir, sourcePath)} -> ${path.relative(rootDir, targetPath)} (${before} -> ${after} bytes)`);
  }
}

console.log(`Optimized ${converted} image${converted === 1 ? "" : "s"}; saved ${(savedBytes / 1024 / 1024).toFixed(1)} MB.`);
