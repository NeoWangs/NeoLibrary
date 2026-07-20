import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const args = process.argv.slice(2);
const dataPath = path.resolve(argValue("--data", "books-data.js"));
const outputDir = path.resolve(argValue("--out-dir", "assets/covers"));
const concurrency = Math.max(1, Number(argValue("--concurrency", "6")) || 6);

if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: node download_cover_images.mjs [--data books-data.js] [--out-dir assets/covers] [--concurrency 6]");
  process.exit(0);
}

function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function readBookData(source, filename) {
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox, { filename });
  const data = sandbox.window.BOOK_CATEGORY_DATA;
  if (!data?.books || !Array.isArray(data.books)) {
    throw new Error("Expected window.BOOK_CATEGORY_DATA.books in the data file.");
  }
  return data;
}

function extensionFor(response, sourceUrl) {
  const type = response.headers.get("content-type")?.split(";")[0].toLowerCase();
  if (type === "image/png") return ".png";
  if (type === "image/gif") return ".gif";
  if (type === "image/webp") return ".webp";
  if (type === "image/jpeg" || type === "image/jpg") return ".jpg";
  return path.extname(new URL(sourceUrl).pathname).match(/^\.(?:jpe?g|png|gif|webp)$/i)?.[0].toLowerCase() || ".jpg";
}

async function downloadCover(book) {
  const sourceUrl = book["封面图片"];
  if (!book.id || !/^https?:\/\//.test(sourceUrl)) return { status: "skipped", book };

  const response = await fetch(sourceUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      "Referer": "https://book.douban.com/",
    },
  });
  if (!response.ok) throw new Error(`${book.id}: HTTP ${response.status}`);
  const extension = extensionFor(response, sourceUrl);
  const relativePath = `./assets/covers/${book.id}${extension}`;
  const outputPath = path.join(outputDir, `${book.id}${extension}`);
  fs.writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
  return { status: "downloaded", book, sourceUrl, relativePath };
}

const originalSource = fs.readFileSync(dataPath, "utf8");
const data = readBookData(originalSource, dataPath);
fs.mkdirSync(outputDir, { recursive: true });

const results = [];
let cursor = 0;
async function worker() {
  while (cursor < data.books.length) {
    const book = data.books[cursor++];
    results.push(await downloadCover(book));
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));

let updatedSource = originalSource;
for (const result of results) {
  if (result.status !== "downloaded") continue;
  const escapedUrl = result.sourceUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`("id"\\s*:\\s*"${result.book.id}"[\\s\\S]*?"封面图片"\\s*:\\s*)"${escapedUrl}"`);
  if (!pattern.test(updatedSource)) throw new Error(`Could not update the cover path for ${result.book.id}.`);
  updatedSource = updatedSource.replace(pattern, `$1"${result.relativePath}"`);
}
fs.writeFileSync(dataPath, updatedSource);

const downloaded = results.filter((result) => result.status === "downloaded").length;
const skipped = results.filter((result) => result.status === "skipped").length;
console.log(`Downloaded ${downloaded} cover images to ${outputDir}; skipped ${skipped}.`);
