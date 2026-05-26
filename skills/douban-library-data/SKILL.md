---
name: douban-library-data
description: Fetch Douban Reading book subject pages and update a library shelf web app's books-data.js directly. Use when the user provides book.douban.com subject links, a TSV/table of Douban book links, or asks to crawl Douban book metadata into browser data instead of generating Markdown notes.
---

# Douban Library Data

Use this skill to collect Douban Reading book metadata and write `books-data.js`.

This is adapted from the Douban Book MD workflow, but it does not create `.md` files. It fetches `book.douban.com/subject/<id>/` pages, extracts metadata and 内容简介, infers a category, and writes JavaScript data for the category manager page.

## Workflow

For a TSV with a header row and a Douban subject URL column:

```bash
node skills/douban-library-data/scripts/douban_books_data.mjs --input douban_books.tsv --out books-data.js --delay-ms 3000
```

For safer long batches, use random delay and small batches:

```bash
node skills/douban-library-data/scripts/douban_books_data.mjs --input douban_books.tsv --out books-data.js --start 1 --limit 30 --delay-min-ms 10000 --delay-max-ms 25000
```

For one book:

```bash
node skills/douban-library-data/scripts/douban_books_data.mjs --url https://book.douban.com/subject/1084336/ --out books-data.js
```

Then check the app script:

```bash
node --check app.js
node --check skills/douban-library-data/scripts/douban_books_data.mjs
```

## Options

- `--input FILE`: TSV input. The script finds the first `https://book.douban.com/subject/<id>/` cell in each data row.
- `--url URL`: Fetch one Douban subject URL.
- `--out FILE`: Output path. Defaults to `books-data.js`.
- `--start N`: Start at 1-based TSV data row N.
- `--limit N`: Process at most N rows.
- `--delay-ms N`: Fixed delay between requests.
- `--delay-min-ms N --delay-max-ms M`: Random delay between requests. Prefer this for longer batches.
- `--retries N`: Retry count for fetch failures. Defaults to 2.
- `--skip-existing`: If the output data already has the subject id, skip fetching it.
- `--replace`: Ignore the existing output file and write only fetched books. Without this, existing books are merged and existing category/order choices are preserved.

Stop and resume later if Douban returns HTTP 403/429 or a fallback page. The script stops on those cases instead of continuing to produce bad data.

## Output Shape

The script writes:

```js
window.BOOK_CATEGORY_DATA = {
  generatedAt,
  categories,
  books
};
```

Each book includes:

```js
{
  id,
  title,
  category,
  作者,
  国籍,
  译者,
  出版社,
  出版年,
  ISBN,
  页数,
  装帧,
  定价,
  原作名,
  评分,
  评分人数,
  内容简介
}
```

Missing fields are omitted. Do not add `frontmatterCategory` or `originalCategory`; the web app derives category-change state from its initial `category` values and localStorage. Do not add the old `file` field. Do not add legacy aliases such as `author`, `rating`, or `ratingCount` unless the target app explicitly requires them.

## Category Rules

The bundled `scripts/book_category_rules.mjs` infers broad categories from title, author/publisher/original title, and synopsis text. Adjust this file when the target project needs different category names or title overrides.
