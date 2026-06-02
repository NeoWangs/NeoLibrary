import fs from "node:fs";
import path from "node:path";
import { inferBookCategory } from "./book_category_rules.mjs";

const METADATA_KEYS = ["作者", "国籍", "译者", "出版社", "出版年", "ISBN", "页数", "装帧", "定价", "原作名", "评分", "评分人数", "内容简介", "封面图片"];
const args = process.argv.slice(2);

const input = argValue("--input");
const url = argValue("--url");
const outPath = argValue("--out", "category-manager/books-data.js");
const limit = Number(argValue("--limit", "0"));
const start = Number(argValue("--start", "1"));
const delayMs = Number(argValue("--delay-ms", "500"));
const delayMinMs = Number(argValue("--delay-min-ms", "0"));
const delayMaxMs = Number(argValue("--delay-max-ms", "0"));
const retries = Number(argValue("--retries", "2"));
const skipExisting = args.includes("--skip-existing");
const replace = args.includes("--replace");

if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: node douban_books_data.mjs (--input books.tsv | --url https://book.douban.com/subject/1084336/) [--out category-manager/books-data.js] [--start 1] [--limit 30] [--delay-ms 3000 | --delay-min-ms 10000 --delay-max-ms 25000] [--retries 2] [--skip-existing] [--replace]");
  process.exit(0);
}

if (!input && !url) {
  console.error("Usage: node douban_books_data.mjs (--input books.tsv | --url https://book.douban.com/subject/1084336/) [--out category-manager/books-data.js] [--start 1] [--limit 30] [--delay-ms 3000 | --delay-min-ms 10000 --delay-max-ms 25000] [--retries 2] [--skip-existing] [--replace]");
  process.exit(1);
}

function argValue(name, fallback = "") {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function decodeHtml(input = "") {
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    middot: "·",
    ldquo: "“",
    rdquo: "”",
    lsquo: "‘",
    rsquo: "’",
    mdash: "—",
  };

  return input
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => named[name] ?? match);
}

function stripTags(input = "") {
  return decodeHtml(input)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function compact(input = "") {
  return stripTags(input).replace(/\s+/g, " ").trim();
}

function splitMultiValue(key, value) {
  if (!["作者", "译者"].includes(key) || !value) return [value].filter(Boolean);
  return value.split(/\s+\/\s+/).map((item) => item.trim()).filter(Boolean);
}

function parseNationalityPrefix(value) {
  const match = value.match(/^\s*[\[【［(（]\s*([^\]】］)）]+?)\s*[\]】］)）]\s*(.+)$/);
  if (!match) return { name: value, nationality: "" };
  return {
    nationality: match[1].replace(/\s+/g, ""),
    name: match[2].trim(),
  };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function valueOrList(values) {
  if (values.length === 0) return "";
  return values.length === 1 ? values[0] : values;
}

function expandAuthors(rawAuthor) {
  const authors = splitMultiValue("作者", rawAuthor).map(parseNationalityPrefix);
  return {
    作者: valueOrList(authors.map((author) => author.name).filter(Boolean)),
    国籍: valueOrList(unique(authors.map((author) => author.nationality))),
  };
}

function getTitle(html, subjectId) {
  const h1 = html.match(/<h1[^>]*>\s*<span[^>]*property="v:itemreviewed"[^>]*>([\s\S]*?)<\/span>/i);
  if (h1) return compact(h1[1]);

  const og = html.match(/<meta\s+property="og:title"\s+content="([^"]*)"/i);
  if (og) return decodeHtml(og[1]).trim();

  const title = html.match(/<title>([\s\S]*?)<\/title>/i);
  return title ? compact(title[1]).replace(/\s*\(豆瓣\)\s*$/, "") : `subject-${subjectId}`;
}

function getInfoBlock(html) {
  return html.match(/<div id="info"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "";
}

function fieldFromInfo(html, label) {
  const info = getInfoBlock(html);
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = info.match(new RegExp(`<span class="pl">\\s*${escaped}\\s*:?\\s*<\\/span>\\s*:?([\\s\\S]*?)(?:<br\\s*\\/?>|<\\/span>\\s*<br\\s*\\/?>)`, "i"));
  return match ? compact(match[1]) : "";
}

function getRatingParts(html) {
  const score = compact(html.match(/<strong[^>]*class="[^"]*rating_num[^"]*"[^>]*>([\s\S]*?)<\/strong>/i)?.[1] ?? "");
  const count = compact(html.match(/<div class="rating_sum">[\s\S]*?<span[^>]*>\s*(?:<a[^>]*>)?([\s\S]*?)(?:<\/a>)?\s*<\/span>/i)?.[1] ?? "");
  return {
    score,
    count: count.replace(/[^\d]/g, "") || count,
  };
}

function getCoverImage(html) {
  const mainPic = html.match(/<div id="mainpic"[\s\S]*?<img[^>]+src="([^"]+)"/i)?.[1];
  if (mainPic) return decodeHtml(mainPic).trim();

  const ogImage = html.match(/<meta\s+property="og:image"\s+content="([^"]*)"/i)?.[1];
  return ogImage ? decodeHtml(ogImage).trim() : "";
}

function getIntro(html) {
  const allIntro = html.match(/<span class="all hidden">[\s\S]*?<div class="intro">([\s\S]*?)<\/div>[\s\S]*?<\/span>/i);
  if (allIntro) return stripTags(allIntro[1]);

  const introAfterHeading = html.match(/<span>内容简介<\/span>[\s\S]*?<div class="intro">([\s\S]*?)<\/div>/i);
  return introAfterHeading ? stripTags(introAfterHeading[1]) : "";
}

function parseInput() {
  if (url) return [{ name: "", url }];

  const rows = fs.readFileSync(input, "utf8").split(/\r?\n/).filter(Boolean);
  return rows
    .slice(1)
    .map((line) => {
      const cells = line.split("\t");
      const rowUrl = cells.find((cell) => /https:\/\/book\.douban\.com\/subject\/\d+\//.test(cell));
      return { name: cells[0]?.trim() ?? "", url: rowUrl?.trim() ?? "" };
    })
    .filter((row) => /https:\/\/book\.douban\.com\/subject\/\d+\//.test(row.url));
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextDelayMs() {
  if (delayMinMs > 0 && delayMaxMs > 0) {
    const min = Math.min(delayMinMs, delayMaxMs);
    const max = Math.max(delayMinMs, delayMaxMs);
    return Math.floor(min + Math.random() * (max - min + 1));
  }
  return delayMs;
}

async function fetchHtml(targetUrl) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
    });
    if (response.ok) return response.text();

    lastError = new Error(`HTTP ${response.status}`);
    if (response.status === 429 && attempt < retries) {
      await sleep(Math.max(delayMs * 4, 15000));
      continue;
    }
    throw lastError;
  }
  throw lastError;
}

function assignIfPresent(target, key, value) {
  if (Array.isArray(value) ? value.length > 0 : value) {
    target[key] = value;
  }
}

async function fetchBook(row) {
  const subjectId = row.url.match(/subject\/(\d+)/)?.[1] ?? "";
  const html = await fetchHtml(row.url);
  const title = getTitle(html, subjectId) || row.name || `subject-${subjectId}`;
  if (title === "豆瓣" || !getInfoBlock(html)) {
    throw new Error("unexpected Douban fallback page");
  }

  const intro = getIntro(html);
  const coverImage = getCoverImage(html);
  const rating = getRatingParts(html);
  const authorParts = expandAuthors(fieldFromInfo(html, "作者"));
  const category = inferBookCategory({
    title,
    text: [
      fieldFromInfo(html, "作者"),
      fieldFromInfo(html, "译者"),
      fieldFromInfo(html, "出版社"),
      fieldFromInfo(html, "原作名"),
      intro,
    ].join("\n"),
  });
  const book = {
    id: subjectId,
    title,
    category,
  };

  assignIfPresent(book, "作者", authorParts["作者"]);
  assignIfPresent(book, "国籍", authorParts["国籍"]);
  assignIfPresent(book, "译者", valueOrList(splitMultiValue("译者", fieldFromInfo(html, "译者"))));
  assignIfPresent(book, "出版社", fieldFromInfo(html, "出版社"));
  assignIfPresent(book, "出版年", fieldFromInfo(html, "出版年"));
  assignIfPresent(book, "ISBN", fieldFromInfo(html, "ISBN"));
  assignIfPresent(book, "页数", fieldFromInfo(html, "页数"));
  assignIfPresent(book, "装帧", fieldFromInfo(html, "装帧"));
  assignIfPresent(book, "定价", fieldFromInfo(html, "定价"));
  assignIfPresent(book, "原作名", fieldFromInfo(html, "原作名"));
  assignIfPresent(book, "评分", rating.score);
  assignIfPresent(book, "评分人数", rating.count);
  assignIfPresent(book, "内容简介", intro);
  assignIfPresent(book, "封面图片", coverImage);
  return book;
}

function readExistingData(file) {
  if (replace || !fs.existsSync(file)) return { categories: [], books: [] };
  const text = fs.readFileSync(file, "utf8");
  const json = text.match(/window\.BOOK_CATEGORY_DATA\s*=\s*([\s\S]*);\s*$/)?.[1];
  if (!json) return { categories: [], books: [] };
  return JSON.parse(json);
}

function cleanBook(book) {
  const next = {
    id: book.id,
    title: book.title,
    category: book.category,
  };
  for (const key of METADATA_KEYS) assignIfPresent(next, key, book[key]);
  return next;
}

function mergeBooks(existingData, fetchedBooks) {
  if (replace) return fetchedBooks.map(cleanBook);

  const fetchedById = new Map(fetchedBooks.map((book) => [book.id, cleanBook(book)]));
  const merged = [];
  const seen = new Set();

  for (const existing of existingData.books ?? []) {
    const fresh = fetchedById.get(existing.id);
    if (fresh) {
      merged.push(cleanBook({
        ...fresh,
        category: existing.category || fresh.category,
      }));
      seen.add(existing.id);
    } else {
      merged.push(cleanBook(existing));
    }
  }

  for (const fresh of fetchedBooks) {
    if (!seen.has(fresh.id) && !merged.some((book) => book.id === fresh.id)) {
      merged.push(cleanBook(fresh));
    }
  }

  return merged;
}

function categoriesFor(existingData, books) {
  const existingCategories = replace ? [] : (existingData.categories ?? []);
  return unique([...existingCategories, ...books.map((book) => book.category)]);
}

const existingData = readExistingData(outPath);
const existingIds = new Set((existingData.books ?? []).map((book) => book.id));
const rows = parseInput().slice(Math.max(start - 1, 0));
const selectedRows = limit > 0 ? rows.slice(0, limit) : rows;
const fetchedBooks = [];
let ok = 0;
let failed = 0;

for (const [index, row] of selectedRows.entries()) {
  const subjectId = row.url.match(/subject\/(\d+)/)?.[1] ?? "";
  if (skipExisting && existingIds.has(subjectId)) {
    ok += 1;
    console.log(`${start + index}/${start + selectedRows.length - 1} skipped: ${subjectId}`);
    continue;
  }

  try {
    const book = await fetchBook(row);
    fetchedBooks.push(book);
    ok += 1;
    console.log(`${start + index}/${start + selectedRows.length - 1} fetched: ${book.title}-${book.id}`);
    const waitMs = nextDelayMs();
    if (waitMs > 0 && index < selectedRows.length - 1) {
      console.log(`waiting ${Math.round(waitMs / 1000)}s`);
      await sleep(waitMs);
    }
  } catch (error) {
    failed += 1;
    console.error(`${start + index}/${start + selectedRows.length - 1} failed: ${row.url} ${error.message}`);
    if (/HTTP (403|429)/.test(error.message) || /unexpected Douban fallback page/.test(error.message)) {
      console.error("stopping after Douban access limit; resume later with the same --start value");
      break;
    }
  }
}

const books = mergeBooks(existingData, fetchedBooks);
const categories = categoriesFor(existingData, books);
const outputData = {
  ...existingData,
  generatedAt: new Date().toISOString(),
  categories,
  books,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(
  outPath,
  `window.BOOK_CATEGORY_DATA = ${JSON.stringify(outputData, null, 2)};\n`,
  "utf8",
);

console.log(`done: ${ok} ok, ${failed} failed`);
console.log(`books=${books.length}`);
console.log(`categories=${categories.length}`);
console.log(`out=${outPath}`);
