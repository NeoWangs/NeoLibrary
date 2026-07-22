const STORAGE_KEY = "douban-category-manager-state-v1";
const RAIL_STORAGE_KEY = "douban-category-manager-rail-visible-v1";
const LAYOUT_STORAGE_KEY = "douban-category-manager-layout-v1";
const BOOK_METADATA_KEYS = ["作者", "国籍", "译者", "原作名", "出版社", "出版年", "ISBN", "页数", "装帧", "定价", "评分", "评分人数", "内容简介", "封面图片"];
const AUDIOBOOKSHELF_BASE_URL = "http://neoxone.synology.me:8081";

const initialData = window.BOOK_CATEGORY_DATA ?? { appTitle: "藏书阁", categories: [], books: [] };
let appTitle = metadataText(initialData.appTitle) || "藏书阁";
const initialCategoryById = new Map(initialData.books.map((book) => [book.id, book.category]));
let books = clone(initialData.books).map(cleanBook);
let categories = [...initialData.categories];
let activeCategories = new Set();
let ratingSortedCategories = new Set();
let layoutMode = "list";
let query = "";
let navClickTimer = 0;

const els = {
  board: document.querySelector("#board"),
  categoryNav: document.querySelector("#categoryNav"),
  searchInput: document.querySelector("#searchInput"),
  newCategoryInput: document.querySelector("#newCategoryInput"),
  addCategoryBtn: document.querySelector("#addCategoryBtn"),
  exportJsonBtn: document.querySelector("#exportJsonBtn"),
  exportTsvBtn: document.querySelector("#exportTsvBtn"),
  importJsonInput: document.querySelector("#importJsonInput"),
  resetBtn: document.querySelector("#resetBtn"),
  toggleRailBtn: document.querySelector("#toggleRailBtn"),
  bookDialog: document.querySelector("#bookDialog"),
  bookDialogBody: document.querySelector("#bookDialogBody"),
  bookDialogClose: document.querySelector("#bookDialogClose"),
  appTitle: document.querySelector("#appTitle"),
  bookCount: document.querySelector("#bookCount"),
  categoryCount: document.querySelector("#categoryCount"),
  changedCount: document.querySelector("#changedCount"),
  layoutButtons: document.querySelectorAll(".layout-btn"),
};

hydrate();
applyAppConfig();
hydrateRail();
hydrateLayout();
render();

els.searchInput.addEventListener("input", (event) => {
  query = event.target.value.trim().toLowerCase();
  render();
});

els.addCategoryBtn.addEventListener("click", addCategory);
els.newCategoryInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addCategory();
});

els.exportJsonBtn.addEventListener("click", () => {
  download("douban-category-updates.json", JSON.stringify(exportPayload(), null, 2), "application/json");
});

els.exportTsvBtn.addEventListener("click", () => {
  const header = ["书名", "subject_id", "当前分类", "分类内排序", ...BOOK_METADATA_KEYS];
  const orderById = categoryOrderById();
  const rows = books.map((book) => [
    book.title,
    book.id,
    book.category,
    orderById.get(book.id),
    ...BOOK_METADATA_KEYS.map((key) => metadataText(book[key])),
  ]);
  download("douban-category-updates.tsv", [header, ...rows].map((row) => row.map(tsvCell).join("\t")).join("\n") + "\n", "text/tab-separated-values");
});

els.importJsonInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const payload = JSON.parse(await file.text());
  const importedBooks = payload.books ?? payload;
  const byId = new Map(importedBooks.map((book) => [book.id, book]));
  const merged = books.map((book) => {
    const imported = byId.get(book.id);
    return imported?.category ? { ...book, category: imported.category } : book;
  });
  const importedOrder = importedBooks.map((book) => String(book.id ?? "")).filter(Boolean);
  const order = new Map(importedOrder.map((id, index) => [id, index]));
  const importedTitle = metadataText(payload.appTitle).trim();
  if (importedTitle) setAppTitle(importedTitle, { save: false });
  books = merged.sort((a, b) => {
    const aOrder = order.has(a.id) ? order.get(a.id) : Number.MAX_SAFE_INTEGER;
    const bOrder = order.has(b.id) ? order.get(b.id) : Number.MAX_SAFE_INTEGER;
    return aOrder - bOrder;
  });
  categories = unique([...(payload.categories ?? categories), ...books.map((book) => book.category)]);
  persist();
  render();
  event.target.value = "";
});

els.resetBtn.addEventListener("click", () => {
  appTitle = metadataText(initialData.appTitle) || "藏书阁";
  books = clone(initialData.books).map(cleanBook);
  categories = [...initialData.categories];
  activeCategories = new Set();
  ratingSortedCategories = new Set();
  query = "";
  els.searchInput.value = "";
  localStorage.removeItem(STORAGE_KEY);
  applyAppConfig();
  render();
});

els.toggleRailBtn.addEventListener("click", () => setRailVisible(document.body.classList.contains("rail-hidden")));
els.layoutButtons.forEach((button) => {
  button.addEventListener("click", () => setLayoutMode(button.dataset.layout));
});
els.bookDialogClose.addEventListener("click", closeBookDialog);
els.bookDialog.addEventListener("click", (event) => {
  if (event.target === els.bookDialog) closeBookDialog();
});
els.appTitle?.addEventListener("dblclick", startAppTitleEdit);

function hydrate() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return;
  try {
    const state = JSON.parse(saved);
    if (Array.isArray(state.books) && Array.isArray(state.categories)) {
      appTitle = metadataText(state.appTitle) || appTitle;
      books = mergeSavedBooks(state.books);
      categories = unique([...state.categories, ...books.map((book) => book.category)]);
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function hydrateRail() {
  const visible = localStorage.getItem(RAIL_STORAGE_KEY);
  setRailVisible(visible !== "false", { persist: false });
}

function hydrateLayout() {
  const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
  setLayoutMode(["list", "spine", "cover"].includes(saved) ? saved : "list", { persist: false, rerender: false });
}

function applyAppConfig() {
  document.title = appTitle;
  if (els.appTitle) els.appTitle.textContent = appTitle;
}

function setAppTitle(nextTitle, { save = true } = {}) {
  const normalized = metadataText(nextTitle).trim();
  if (!normalized) return;
  appTitle = normalized;
  applyAppConfig();
  if (save) persist();
}

function startAppTitleEdit() {
  if (!els.appTitle || document.querySelector(".app-title-input")) return;

  const input = document.createElement("input");
  input.className = "app-title-input";
  input.type = "text";
  input.value = appTitle;
  input.setAttribute("aria-label", "应用标题");
  els.appTitle.replaceWith(input);
  input.focus();
  input.select();

  let finished = false;
  const finish = (save) => {
    if (finished) return;
    finished = true;
    input.replaceWith(els.appTitle);
    if (save) setAppTitle(input.value);
    else applyAppConfig();
  };

  input.addEventListener("blur", () => finish(true));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") finish(true);
    if (event.key === "Escape") finish(false);
  });
}

function setRailVisible(visible, { persist = true } = {}) {
  document.body.classList.toggle("rail-hidden", !visible);
  const label = visible ? "隐藏分类列表" : "显示分类列表";
  els.toggleRailBtn.title = label;
  els.toggleRailBtn.setAttribute("aria-label", label);
  els.toggleRailBtn.setAttribute("aria-expanded", String(visible));
  if (persist) localStorage.setItem(RAIL_STORAGE_KEY, String(visible));
}

function setLayoutMode(nextMode, { persist = true, rerender = true } = {}) {
  layoutMode = ["list", "spine", "cover"].includes(nextMode) ? nextMode : "list";
  els.board.classList.toggle("is-spine", layoutMode === "spine");
  els.board.classList.toggle("is-cover", layoutMode === "cover");
  els.board.classList.toggle("is-list", layoutMode === "list");
  els.layoutButtons.forEach((button) => {
    const active = button.dataset.layout === layoutMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (persist) localStorage.setItem(LAYOUT_STORAGE_KEY, layoutMode);
  if (rerender) render();
}

function render() {
  const visibleBooks = books.filter(matchesQuery);
  const changed = books.filter(hasCategoryChange);
  const grouped = groupByCategory(visibleBooks);
  const categoryList = orderedCategories();
  const renderedCategories = categoryList;

  els.bookCount.textContent = String(visibleBooks.length);
  els.categoryCount.textContent = String(categoryList.length);
  els.changedCount.textContent = String(changed.length);

  renderNav(categoryList);
  els.board.innerHTML = renderedCategories.map((category) => categoryPanel(category, grouped.get(category) ?? [])).join("");
  bindDragEvents();
}

function renderNav(categoryList) {
  const counts = new Map();
  for (const book of books.filter(matchesQuery)) counts.set(book.category, (counts.get(book.category) ?? 0) + 1);
  const items = ["全部", ...categoryList];
  els.categoryNav.innerHTML = items.map((category) => {
    const count = category === "全部" ? books.filter(matchesQuery).length : counts.get(category) ?? 0;
    const active = category === "全部" ? activeCategories.size === 0 : activeCategories.has(category);
    const draggable = category === "全部" ? "" : ` draggable="true"`;
    return `<button class="nav-item ${active ? "is-active" : ""}" type="button" data-category="${escapeAttr(category)}"${draggable}>
      <span class="nav-name">${escapeHtml(category)}</span>
      <span class="nav-count">${count}</span>
    </button>`;
  }).join("");

  els.categoryNav.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.clearTimeout(navClickTimer);
      startCategoryEdit(button);
    });
    button.addEventListener("click", (event) => {
      const additive = event.metaKey || event.ctrlKey;
      window.clearTimeout(navClickTimer);
      navClickTimer = window.setTimeout(() => {
        const category = button.dataset.category;
        selectCategory(category, additive);
        render();
        scrollToCategory(category);
      }, 160);
    });
    button.addEventListener("dragstart", (event) => {
      const category = button.dataset.category;
      if (category === "全部") return;
      button.classList.add("is-dragging");
      event.dataTransfer.setData("application/x-category", category);
      event.dataTransfer.effectAllowed = "move";
    });
    button.addEventListener("dragover", (event) => {
      const category = button.dataset.category;
      if (category === "全部") return;
      const draggedCategory = event.dataTransfer.types.includes("application/x-category");
      const draggedBook = event.dataTransfer.types.includes("application/x-book-id") || event.dataTransfer.types.includes("text/plain");
      if (!draggedCategory && !draggedBook) return;

      event.preventDefault();
      clearNavDropClasses(button);
      if (draggedCategory) {
        button.classList.add(getCategoryDropPosition(event, button) === "after" ? "is-drop-after" : "is-drop-before");
      } else {
        button.classList.add("is-drop-target");
      }
    });
    button.addEventListener("dragleave", () => {
      clearNavDropClasses(button);
    });
    button.addEventListener("drop", (event) => {
      const category = button.dataset.category;
      if (category === "全部") return;
      event.preventDefault();
      const draggedCategory = event.dataTransfer.getData("application/x-category");
      clearNavDropClasses(button);
      if (draggedCategory) {
        moveCategory(draggedCategory, category, getCategoryDropPosition(event, button));
        return;
      }

      const id = event.dataTransfer.getData("application/x-book-id") || event.dataTransfer.getData("text/plain");
      moveBook(id, category);
    });
    button.addEventListener("dragend", () => {
      button.classList.remove("is-dragging");
      els.categoryNav.querySelectorAll(".nav-item").forEach(clearNavDropClasses);
    });
  });
}

function categoryPanel(category, items) {
  const sorted = booksForCategoryView(category, items);
  const isRatingSorted = ratingSortedCategories.has(category);
  const sortLabel = isRatingSorted ? "恢复原顺序" : "按评分排序";
  const deleteButton = items.length === 0
    ? `<button class="delete-category-btn" type="button" data-category="${escapeAttr(category)}" title="删除空分类" aria-label="删除空分类 ${escapeAttr(category)}" draggable="false">
        <span>删除</span>
      </button>`
    : "";
  const cards = sorted.length > 0
    ? sorted.map(bookCard).join("")
    : `<div class="empty">空</div>`;

  return `<article class="category-panel" data-category="${escapeAttr(category)}">
    <header class="category-header" draggable="true" data-category="${escapeAttr(category)}">
      <div>
        <div class="category-title">${escapeHtml(category)}<span class="category-count">（${items.length} 本）</span></div>
      </div>
      <div class="category-actions">
        ${deleteButton}
      <button class="rating-sort-btn ${isRatingSorted ? "is-active" : ""}" type="button" data-category="${escapeAttr(category)}" title="${sortLabel}" aria-label="${sortLabel}" draggable="false">
        <span>排序</span>
      </button>
      </div>
    </header>
    <div class="book-list" data-category="${escapeAttr(category)}">${cards}</div>
  </article>`;
}

function bookCard(book) {
  const rating = bookRating(book) ? `<span class="rating-pill">${escapeHtml(bookRating(book))}</span>` : "";
  const author = metadataText(book["作者"]).trim();
  const title = bookDisplayTitle(book);
  const coverImage = metadataText(book["封面图片"]).trim();
  const audiobookshelfUrl = getAudiobookshelfUrl(book);
  const titleClass = `book-title${audiobookshelfUrl ? " book-title--audiobookshelf" : ""}`;
  const titleContent = audiobookshelfUrl
    ? `<a class="${titleClass}" href="${escapeAttr(audiobookshelfUrl)}" target="_blank" rel="noreferrer" title="在 Audiobookshelf 中打开">${escapeHtml(title)}</a>`
    : `<span class="${titleClass}">${escapeHtml(title)}</span>`;
  const spineStyle = layoutMode === "spine" ? ` style="${spineStyleVars(book)}"` : "";
  const cover = coverImage
    ? `<img class="book-cover-image" src="${escapeAttr(coverImage)}" alt="${escapeAttr(`${title} 封面`)}" loading="lazy">`
    : `<span class="book-cover-placeholder" aria-hidden="true">${escapeHtml(title.slice(0, 1) || "书")}</span>`;
  const coverAbsBadge = layoutMode === "cover" && audiobookshelfUrl
    ? `<span class="cover-abs-badge" aria-hidden="true">ABS</span>`
    : "";

  return `<div class="book-card" draggable="true" role="button" tabindex="0" data-id="${escapeAttr(book.id)}"${spineStyle} aria-label="查看《${escapeAttr(title)}》详情">
    <figure class="book-cover">${cover}</figure>
    ${coverAbsBadge}
    <div class="book-main">
      ${titleContent}
      ${audiobookshelfUrl ? `<span class="book-abs-badge" title="可在 Audiobookshelf 中打开" aria-label="Audiobookshelf 已匹配">ABS</span>` : ""}
      <span class="inline-chip">${escapeHtml(book.id)}</span>
      ${rating}
      ${author ? `<span class="book-author">${escapeHtml(author)}</span>` : ""}
    </div>
  </div>`;
}

function spineStyleVars(book) {
  const title = bookDisplayTitle(book);
  const seed = hashText(`${book.id}:${title}`);
  const hue = seed % 360;
  const titleUnits = verticalTextUnits(title);
  const titleColumns = Math.min(3, Math.max(1, Math.ceil(titleUnits / 9)));
  const titleFontSize = spineTitleFontSize(titleUnits);
  const baseHeight = 128 + (seed % 24);
  const titleHeight = 78 + Math.ceil(titleUnits / titleColumns) * titleFontSize * 1.08;
  const height = Math.round(Math.min(190, Math.max(baseHeight, titleHeight)));
  const titleWidth = titleColumns === 1
    ? 22
    : Math.ceil(titleColumns * 16);
  const width = Math.max(32 + (seed % 8) + (titleColumns - 1) * 14, titleWidth + 12);
  return `--spine-hue:${hue};--spine-height:${height}px;--spine-width:${width}px;--title-width:${titleWidth}px;--title-font-size:${titleFontSize}px`;
}

function verticalTextUnits(value) {
  return [...metadataText(value).replace(/\s+/g, "")].length;
}

function spineTitleFontSize(titleUnits) {
  if (titleUnits > 30) return 8.5;
  if (titleUnits > 24) return 9.5;
  if (titleUnits > 18) return 11;
  return 14;
}

function bookDisplayTitle(book) {
  return metadataText(book.title);
}

function bindDragEvents() {
  els.board.querySelectorAll(".delete-category-btn").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteEmptyCategory(button.dataset.category);
    });
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("dragstart", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
  });

  els.board.querySelectorAll(".rating-sort-btn").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleRatingSort(button.dataset.category);
    });
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("dragstart", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
  });

  els.board.querySelectorAll(".category-header").forEach((header) => {
    header.addEventListener("dragstart", (event) => {
      if (event.target.closest(".rating-sort-btn, .delete-category-btn")) return;
      header.classList.add("is-dragging");
      event.dataTransfer.setData("application/x-category", header.dataset.category);
      event.dataTransfer.effectAllowed = "move";
    });
    header.addEventListener("dragend", () => {
      header.classList.remove("is-dragging");
      els.board.querySelectorAll(".category-panel").forEach(clearPanelDropClasses);
      els.categoryNav.querySelectorAll(".nav-item").forEach(clearNavDropClasses);
    });
  });

  els.board.querySelectorAll(".category-panel").forEach((panel) => {
    panel.addEventListener("dragover", (event) => {
      const draggedCategory = event.dataTransfer.types.includes("application/x-category");
      if (!draggedCategory) return;
      event.preventDefault();
      clearPanelDropClasses(panel);
      panel.classList.add(getPanelDropPosition(event, panel) === "after" ? "is-drop-after" : "is-drop-before");
    });
    panel.addEventListener("dragleave", (event) => {
      if (panel.contains(event.relatedTarget)) return;
      clearPanelDropClasses(panel);
    });
    panel.addEventListener("drop", (event) => {
      const draggedCategory = event.dataTransfer.getData("application/x-category");
      if (!draggedCategory) return;
      event.preventDefault();
      clearPanelDropClasses(panel);
      moveCategory(draggedCategory, panel.dataset.category, getPanelDropPosition(event, panel));
    });
  });

  els.board.querySelectorAll(".book-card").forEach((card) => {
    let movedDuringDrag = false;
    card.addEventListener("dragstart", (event) => {
      movedDuringDrag = true;
      card.classList.add("is-dragging");
      event.dataTransfer.setData("application/x-book-id", card.dataset.id);
      event.dataTransfer.setData("text/plain", card.dataset.id);
      event.dataTransfer.effectAllowed = "move";
    });
    card.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.stopPropagation();
      card.classList.add("is-drop-before");
    });
    card.addEventListener("dragleave", () => card.classList.remove("is-drop-before"));
    card.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      card.classList.remove("is-drop-before");
      const id = event.dataTransfer.getData("application/x-book-id") || event.dataTransfer.getData("text/plain");
      const targetCategory = card.closest(".book-list")?.dataset.category;
      moveBook(id, targetCategory, card.dataset.id);
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("is-dragging");
      els.board.querySelectorAll(".is-drop-before").forEach((item) => item.classList.remove("is-drop-before"));
      els.board.querySelectorAll(".is-drop-after").forEach((item) => item.classList.remove("is-drop-after"));
      els.board.querySelectorAll(".is-drop-target").forEach((item) => item.classList.remove("is-drop-target"));
      els.categoryNav.querySelectorAll(".nav-item").forEach(clearNavDropClasses);
      window.setTimeout(() => {
        movedDuringDrag = false;
      }, 0);
    });
    card.addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      if (movedDuringDrag) return;
      openBookDialog(card.dataset.id);
    });
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openBookDialog(card.dataset.id);
    });
  });

  els.board.querySelectorAll(".book-list").forEach((list) => {
    list.addEventListener("dragover", (event) => {
      event.preventDefault();
      list.closest(".category-panel")?.classList.add("is-drop-target");
    });
    list.addEventListener("dragleave", () => list.closest(".category-panel")?.classList.remove("is-drop-target"));
    list.addEventListener("drop", (event) => {
      event.preventDefault();
      list.closest(".category-panel")?.classList.remove("is-drop-target");
      const id = event.dataTransfer.getData("application/x-book-id") || event.dataTransfer.getData("text/plain");
      moveBook(id, list.dataset.category);
    });
  });
}

function openBookDialog(id) {
  const book = books.find((item) => item.id === id);
  if (!book) return;

  els.bookDialogBody.innerHTML = bookDialogContent(book);
  if (typeof els.bookDialog.showModal === "function") {
    els.bookDialog.showModal();
  } else {
    els.bookDialog.setAttribute("open", "");
  }
}

function closeBookDialog() {
  if (typeof els.bookDialog.close === "function") {
    els.bookDialog.close();
  } else {
    els.bookDialog.removeAttribute("open");
  }
}

function bookDialogContent(book) {
  const { rows, synopsis } = bookDetailContent(book);
  const doubanUrl = `https://book.douban.com/subject/${encodeURIComponent(book.id)}/`;
  const audiobookshelfUrl = getAudiobookshelfUrl(book);
  const title = bookDisplayTitle(book);
  const ratingCount = metadataText(book["评分人数"]);
  const rating = bookRating(book)
    ? `<span class="detail-rating"><strong>${escapeHtml(bookRating(book))}</strong>${ratingCount ? `<small>${escapeHtml(ratingCount)} 人</small>` : ""}</span>`
    : "";
  const isbn = metadataText(book["ISBN"]);
  const coverImage = metadataText(book["封面图片"]);
  const cover = coverImage
    ? `<figure class="detail-cover">
        <img src="${escapeAttr(coverImage)}" alt="${escapeAttr(`${title} 封面`)}" loading="lazy">
      </figure>`
    : "";

  return `<article class="book-detail">
    <header class="detail-hero${cover ? " has-cover" : ""}">
      ${cover}
      <div>
        <div class="detail-kicker">Book Detail</div>
        <h1 id="bookDialogTitle">${escapeHtml(title)}</h1>
        <div class="detail-badges">
          <span class="detail-badge">${escapeHtml(book.id)}</span>
          ${isbn ? `<span class="detail-badge">ISBN ${escapeHtml(isbn)}</span>` : ""}
        </div>
        <div class="detail-links">
          <a class="detail-link" href="${escapeAttr(doubanUrl)}" target="_blank" rel="noreferrer">打开豆瓣页面</a>
          ${audiobookshelfUrl ? `<a class="detail-link detail-link--audiobookshelf" href="${escapeAttr(audiobookshelfUrl)}" target="_blank" rel="noreferrer">在 Audiobookshelf 中打开</a>` : ""}
        </div>
      </div>
      ${rating}
    </header>
    <div class="detail-body">
      <div class="detail-side">
        <dl class="detail-list">
          ${rows.map(({ label, value }) => `<div>
            <dt>${escapeHtml(label)}</dt>
            <dd>${escapeHtml(metadataText(value) || "—")}</dd>
          </div>`).join("")}
        </dl>
      </div>
      <section class="detail-synopsis">
        <h2>内容简介</h2>
        <p>${escapeHtml(synopsis || "暂无")}</p>
      </section>
    </div>
  </article>`;
}

function bookDetailContent(book) {
  const optionalCompactKeys = new Set(["译者", "原作名"]);
  const hiddenKeys = new Set(["国籍", "ISBN", "评分", "评分人数", "内容简介", "封面图片"]);
  const baseRows = [
    ...BOOK_METADATA_KEYS
      .filter((key) => !hiddenKeys.has(key))
      .map((key) => [key, key === "作者" ? authorWithNationality(book) : book[key]]),
  ];
  const shownKeys = new Set(["title", "id", "category", "absItemId", ...BOOK_METADATA_KEYS]);
  const extraRows = Object.entries(book)
    .filter(([key]) => !shownKeys.has(key))
    .map(([key, value]) => [key, value]);

  const rows = [...baseRows, ...extraRows]
    .filter(([label, value]) => !optionalCompactKeys.has(label) || metadataText(value))
    .map(([label, value]) => ({ label, value }));
  return { rows, synopsis: metadataText(book["内容简介"]) };
}

function getAudiobookshelfUrl(book) {
  const itemId = metadataText(book.absItemId).trim();
  if (!itemId) return "";
  return `${AUDIOBOOKSHELF_BASE_URL}/audiobookshelf/item/${encodeURIComponent(itemId)}`;
}

function authorWithNationality(book) {
  const author = metadataText(book["作者"]);
  const nationality = metadataText(book["国籍"]);
  if (!author || !nationality) return author;
  return `${author} [${nationality}]`;
}

function addCategory() {
  const category = els.newCategoryInput.value.trim();
  if (!category || categories.includes(category)) return;
  categories = unique([...categories, category]);
  activeCategories = new Set([category]);
  els.newCategoryInput.value = "";
  persist();
  render();
}

function startCategoryEdit(button) {
  const category = button.dataset.category;
  if (!category || category === "全部" || document.querySelector(".category-name-input")) return;

  const input = document.createElement("input");
  input.className = "category-name-input";
  input.type = "text";
  input.value = category;
  input.setAttribute("aria-label", "分类名称");
  button.replaceWith(input);
  input.focus();
  input.select();

  let finished = false;
  const finish = (save) => {
    if (finished) return;
    finished = true;
    if (save) renameCategory(category, input.value);
    else render();
  };

  input.addEventListener("blur", () => finish(true));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") finish(true);
    if (event.key === "Escape") finish(false);
  });
}

function renameCategory(category, nextName) {
  const next = metadataText(nextName).trim();
  if (!next || next === "全部" || next === category || orderedCategories().includes(next)) {
    render();
    return;
  }

  categories = orderedCategories().map((item) => item === category ? next : item);
  for (const book of books) {
    if (book.category === category) book.category = next;
  }

  if (activeCategories.has(category)) {
    activeCategories.delete(category);
    activeCategories.add(next);
  }

  if (ratingSortedCategories.has(category)) {
    ratingSortedCategories.delete(category);
    ratingSortedCategories.add(next);
  }

  persist();
  render();
}

function selectCategory(category, additive = false) {
  if (category === "全部") {
    activeCategories = new Set();
    return;
  }

  if (!additive) {
    activeCategories = new Set([category]);
    return;
  }

  const next = new Set(activeCategories);
  if (next.has(category)) {
    next.delete(category);
  } else {
    next.add(category);
  }
  activeCategories = next;
}

function scrollToCategory(category) {
  window.requestAnimationFrame(() => {
    const target = category === "全部"
      ? els.board
      : [...els.board.querySelectorAll(".category-panel")].find((panel) => panel.dataset.category === category);
    if (!target) return;

    target.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
  });
}

function toggleRatingSort(category) {
  if (!category) return;
  const next = new Set(ratingSortedCategories);
  if (next.has(category)) {
    next.delete(category);
  } else {
    next.add(category);
  }
  ratingSortedCategories = next;
  render();
}

function deleteEmptyCategory(category) {
  if (!category || books.some((book) => book.category === category)) return;
  categories = orderedCategories().filter((item) => item !== category);
  activeCategories.delete(category);
  ratingSortedCategories.delete(category);
  persist();
  render();
}

function booksForCategoryView(category, items) {
  if (!ratingSortedCategories.has(category)) return items;
  return [...items].sort((a, b) => parseRating(bookRating(b)) - parseRating(bookRating(a)));
}

function parseRating(value) {
  const rating = Number.parseFloat(value);
  return Number.isFinite(rating) ? rating : -1;
}

function moveBook(id, category, beforeId = "") {
  if (!id || !category || id === beforeId) return;
  const fromIndex = books.findIndex((item) => item.id === id);
  if (fromIndex < 0) return;
  const currentCategory = books[fromIndex].category;

  if (currentCategory === category && !beforeId) return;
  if (beforeId && !books.some((item) => item.id === beforeId)) return;

  const [book] = books.splice(fromIndex, 1);
  book.category = category;

  let insertIndex = beforeId ? books.findIndex((item) => item.id === beforeId) : -1;
  if (insertIndex < 0) {
    insertIndex = lastIndexInCategory(category) + 1;
  }
  books.splice(insertIndex, 0, book);
  categories = unique([...categories, category]);
  persist();
  render();
}

function moveCategory(category, targetCategory, position = "before") {
  if (!category || !targetCategory || category === targetCategory) return;
  const next = orderedCategories();
  const fromIndex = next.indexOf(category);
  const targetIndex = next.indexOf(targetCategory);
  if (fromIndex < 0 || targetIndex < 0) return;

  next.splice(fromIndex, 1);
  const adjustedTargetIndex = next.indexOf(targetCategory);
  next.splice(position === "after" ? adjustedTargetIndex + 1 : adjustedTargetIndex, 0, category);
  categories = next;
  persist();
  render();
}

function getCategoryDropPosition(event, button) {
  const box = button.getBoundingClientRect();
  return event.clientY > box.top + box.height / 2 ? "after" : "before";
}

function getPanelDropPosition(event, panel) {
  const box = panel.getBoundingClientRect();
  return event.clientY > box.top + box.height / 2 ? "after" : "before";
}

function clearNavDropClasses(item) {
  item.classList.remove("is-drop-target", "is-drop-before", "is-drop-after");
}

function clearPanelDropClasses(item) {
  item.classList.remove("is-drop-target", "is-drop-before", "is-drop-after");
}

function lastIndexInCategory(category) {
  for (let index = books.length - 1; index >= 0; index -= 1) {
    if (books[index].category === category) return index;
  }
  return books.length - 1;
}

function exportPayload() {
  const orderById = categoryOrderById();
  return {
    exportedAt: new Date().toISOString(),
    appTitle,
    categories: orderedCategories(),
    books: books.map((book) => ({
      id: book.id,
      title: book.title,
      category: book.category,
      order: orderById.get(book.id),
      ...metadataPayload(book),
    })),
  };
}

function categoryOrderById() {
  const counters = new Map();
  const orderById = new Map();
  for (const book of books) {
    const next = (counters.get(book.category) ?? 0) + 1;
    counters.set(book.category, next);
    orderById.set(book.id, next);
  }
  return orderById;
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ appTitle, categories, books }));
}

function orderedCategories() {
  return unique([...categories, ...books.map((book) => book.category)]);
}

function hasCategoryChange(book) {
  const initialCategory = initialCategoryById.get(book.id);
  return Boolean(initialCategory && book.category !== initialCategory);
}

function matchesQuery(book) {
  if (!query) return true;
  return [
    book.title,
    book.id,
    book.category,
    ...BOOK_METADATA_KEYS.map((key) => metadataText(book[key])),
  ].some((value) => String(value ?? "").toLowerCase().includes(query));
}

function groupByCategory(items) {
  const grouped = new Map();
  for (const item of items) {
    if (!grouped.has(item.category)) grouped.set(item.category, []);
    grouped.get(item.category).push(item);
  }
  return grouped;
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function tsvCell(value) {
  return String(value ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " ");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeSavedBooks(savedBooks) {
  const freshById = new Map(clone(initialData.books).map((book) => [book.id, cleanBook(book)]));
  const seen = new Set();
  const merged = [];

  for (const savedBook of savedBooks) {
    if (!savedBook?.id) continue;
    const fresh = freshById.get(savedBook.id);
    const book = cleanBook(fresh ? { ...fresh, category: savedBook.category || fresh.category } : savedBook);
    seen.add(savedBook.id);
    merged.push(book);
  }

  for (const fresh of freshById.values()) {
    if (!seen.has(fresh.id)) merged.push(cleanBook(fresh));
  }

  return merged;
}

function cleanBook(book) {
  const allowedKeys = new Set(["id", "title", "category", "absItemId", ...BOOK_METADATA_KEYS]);
  return Object.fromEntries(Object.entries(book).filter(([key]) => allowedKeys.has(key)));
}

function metadataPayload(book) {
  return Object.fromEntries([...BOOK_METADATA_KEYS, "absItemId"].filter((key) => book[key] !== undefined).map((key) => [key, book[key]]));
}

function metadataText(value) {
  return Array.isArray(value) ? value.join(" / ") : String(value ?? "");
}

function bookRating(book) {
  return metadataText(book["评分"]);
}

function hashText(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
