---
name: douban-library-data
description: Fetch Douban Reading book subject pages and update a library shelf web app's books-data.js directly, optionally enriching books with Audiobookshelf UUIDs as `absItemId` by ISBN and title matching. Use when the user provides book.douban.com subject links, a TSV/table of Douban book links, or asks to crawl Douban book metadata into browser data instead of generating Markdown notes.
---

# Douban Library Data

Use this skill to collect Douban Reading book metadata and write `books-data.js`.

This is adapted from the Douban Book MD workflow, but it does not create `.md` files. It fetches `book.douban.com/subject/<id>/` pages, extracts metadata, 内容简介, and the cover image URL, infers a category, and writes JavaScript data for the category manager page.

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

## Match Audiobookshelf UUIDs

To write `absItemId` for matched books, configure `AUDIOBOOKSHELF_API_KEY` through the shell's secret manager and add the Audiobookshelf server URL:

```bash
node skills/douban-library-data/scripts/douban_books_data.mjs --input douban_books.tsv --out books-data.js --audiobookshelf-url http://server:13378
```

Validate Audiobookshelf access before requesting any Douban page. Match by exact normalized ISBN first; otherwise use normalized title (exact, prefix, then containment) with author similarity as a tie-breaker. Allow multiple Douban books to use the same `absItemId`. Stop immediately and report an authentication/login block on missing credentials, HTTP 401/403, or a login/non-API response.

Then check the app script:

```bash
node --check app.js
node --check skills/douban-library-data/scripts/douban_books_data.mjs
```

## Store Cover Images Locally

For a deployable shelf that does not depend on external image hotlinking, download the cover URLs already collected in `books-data.js` and rewrite their references to Git-tracked local assets:

```bash
node skills/douban-library-data/scripts/download_cover_images.mjs --data books-data.js --out-dir assets/covers --concurrency 6
```

The script names each file after its Douban subject ID (for example, `assets/covers/1084336.jpg`) and updates that book's `封面图片` value to `./assets/covers/<id>.<ext>`. Run it after importing new book metadata to add their cover images to the repository.

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
  appTitle,
  categories,
  books
};
```

Preserve top-level personalization fields such as `appTitle` when updating an existing `books-data.js`.

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
  absItemId,
  页数,
  装帧,
  定价,
  原作名,
  评分,
  评分人数,
  内容简介,
  封面图片
}
```

Missing fields are omitted. Do not add `frontmatterCategory` or `originalCategory`; the web app derives category-change state from its initial `category` values and localStorage. Do not add the old `file` field. Do not add legacy aliases such as `author`, `rating`, or `ratingCount` unless the target app explicitly requires them.

For cover images, prefer the small subject cover from `<div id="mainpic"> <img src="...">`, such as `https://img1.doubanio.com/view/subject/s/public/s35212830.jpg`. Fall back to `og:image` only if the main cover image is absent.

## Category Rules

The bundled `scripts/book_category_rules.mjs` infers broad categories from title, author/publisher/original title, and synopsis text. Adjust this file when the target project needs different category names or title overrides.
