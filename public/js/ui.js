// DOM rendering. Plain, framework-free re-render of the active view on each
// state change — data volumes here (local voice-memo history) are small
// enough that a full re-render per interaction stays fast and simple.

import { todayDateString } from "./store.js";

const icons = {
  heart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21s-7-4.35-9.5-8.8C.6 8.6 2.4 5 6 5c2 0 3.3 1 4 2 .7-1 2-2 4-2 3.6 0 5.4 3.6 3.5 7.2C19 16.65 12 21 12 21z"/></svg>`,
  heartFilled: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.8"><path d="M12 21s-7-4.35-9.5-8.8C.6 8.6 2.4 5 6 5c2 0 3.3 1 4 2 .7-1 2-2 4-2 3.6 0 5.4 3.6 3.5 7.2C19 16.65 12 21 12 21z"/></svg>`,
  copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>`,
  speaker: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>`,
  edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  mail: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>`,
};

const PRIORITY_LABELS = { low: "Low", medium: "Medium", high: "High" };
const TASK_FILTERS = ["all", "today", "upcoming", "completed"];
const TASK_FILTER_LABELS = { all: "All", today: "Today", upcoming: "Upcoming", completed: "Completed" };
const TASK_EMPTY_MESSAGES = {
  all: "No tasks yet. Add one, or record a memo to detect tasks automatically.",
  today: "Nothing due today.",
  upcoming: "No upcoming tasks.",
  completed: "No completed tasks yet.",
};

function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function formatDate(ts) {
  const date = new Date(ts);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " · " + date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatDuration(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return "";
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return m > 0 ? `${m}m ${rem}s` : `${rem}s`;
}

export function renderGreetingAndDate() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  document.getElementById("greeting").textContent = greeting;
  document.getElementById("dateLine").textContent = new Date().toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  });
}

export function renderSidebarCounts({ memos, tasks, topics }) {
  document.getElementById("countAll").textContent = memos.length || "";
  document.getElementById("countFavorites").textContent =
    memos.filter((m) => m.favorite).length || "";
  document.getElementById("countTasks").textContent =
    tasks.filter((t) => !t.done).length || "";
  document.getElementById("countTopics").textContent = topics.length || "";
}

export function renderNavActive(view) {
  document.querySelectorAll(".nav-item[data-view]").forEach((el) => {
    el.classList.toggle("active", el.dataset.view === view);
  });
  document.querySelectorAll(".mobile-tab[data-view]").forEach((el) => {
    el.classList.toggle("active", el.dataset.view === view);
  });
}

export function renderRecentTopics(topics, onSelect) {
  const container = document.getElementById("recentTopicChips");
  container.innerHTML = "";
  topics.slice(0, 6).forEach((topic) => {
    const btn = document.createElement("button");
    btn.className = "topic-chip";
    btn.innerHTML = `<span class="dot"></span> ${escapeHtml(topic.name)}`;
    btn.addEventListener("click", () => onSelect(topic.name));
    container.appendChild(btn);
  });
}

function sentimentBadge(sentiment) {
  if (!sentiment || !sentiment.label) return "";
  return `<span class="sentiment-badge ${escapeHtml(sentiment.label)}">${escapeHtml(sentiment.label)}</span>`;
}

function renderMemoDetail(memo, handlers) {
  const actionItemsHtml = memo.actionItems.length
    ? `<ul class="action-item-list">${memo.actionItems.map((item) => `
        <li class="action-item ${item.done ? "is-done" : ""}">
          <input type="checkbox" data-task-toggle="${item.id}" ${item.done ? "checked" : ""} />
          <span>${escapeHtml(item.text)}</span>
        </li>`).join("")}</ul>`
    : `<p class="limitation-note">No action-oriented phrasing detected in this memo.</p>`;

  const topicsHtml = memo.topics.length
    ? `<div class="memo-tags">${memo.topics.map((t) => `<span class="tag tag-clickable" data-topic="${escapeHtml(t)}">${escapeHtml(t)}</span>`).join("")}</div>`
    : `<p class="limitation-note">No key topics detected.</p>`;

  return `
    <div class="memo-detail">
      <div class="detail-block">
        <p class="detail-label">Transcript</p>
        <p class="transcript-text">${escapeHtml(memo.transcript) || "—"}</p>
      </div>

      <div class="detail-block">
        <p class="detail-label">AI Summary</p>
        <p class="summary-text">${escapeHtml(memo.summary) || "No summary available."}</p>
        <p class="limitation-note">Generated deterministically from Azure AI Language key phrases, entities, and sentiment — not an abstractive AI summary.</p>
      </div>

      <div class="detail-block">
        <p class="detail-label">Action Items</p>
        ${actionItemsHtml}
        <p class="limitation-note">Detected via phrase-pattern heuristics over the transcript (Azure AI Language does not provide action-item extraction).</p>
      </div>

      <div class="detail-block">
        <p class="detail-label">Topics</p>
        ${topicsHtml}
      </div>

      <div class="detail-block">
        <p class="detail-label">Sentiment &amp; Language</p>
        <div class="sentiment-row">
          ${sentimentBadge(memo.sentiment)}
          <span>${escapeHtml(memo.language || "")}${memo.confidence != null ? ` · ${Math.round(memo.confidence * 100)}% confidence` : ""}</span>
        </div>
      </div>

      <div class="detail-actions">
        <button class="icon-button" data-action="listen">${icons.speaker} Listen to summary</button>
        <button class="icon-button" data-action="copy">${icons.copy} Copy transcript</button>
        <button class="icon-button danger" data-action="delete">${icons.trash} Delete</button>
      </div>
    </div>
  `;
}

function renderMemoCard(memo, isExpanded) {
  const el = document.createElement("article");
  el.className = "memo-card";
  el.dataset.memoId = memo.id;

  el.innerHTML = `
    <div class="memo-card-top">
      <div>
        <h3 class="memo-title">${escapeHtml(memo.title)}</h3>
        <div class="memo-meta">
          <span>${formatDate(memo.createdAt)}</span>
          ${memo.durationSeconds ? `<span>· ${formatDuration(memo.durationSeconds)}</span>` : ""}
        </div>
      </div>
      <button class="favorite-toggle ${memo.favorite ? "is-favorite" : ""}" data-action="favorite" aria-label="Toggle favorite">
        ${memo.favorite ? icons.heartFilled : icons.heart}
      </button>
    </div>
    ${!isExpanded ? `<p class="memo-snippet">${escapeHtml(memo.summary || memo.transcript)}</p>` : ""}
    ${!isExpanded && memo.topics.length ? `<div class="memo-tags">${memo.topics.slice(0, 4).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
    ${isExpanded ? renderMemoDetail(memo, {}) : ""}
  `;

  return el;
}

export function renderMemoList(container, memos, expandedId) {
  container.innerHTML = "";

  if (memos.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Nothing here yet.";
    container.appendChild(empty);
    return;
  }

  memos.forEach((memo) => {
    container.appendChild(renderMemoCard(memo, memo.id === expandedId));
  });
}

export function renderAllNotesView(memos, expandedId) {
  const section = document.createElement("div");
  section.innerHTML = `<p class="section-title">Recent memos</p><div class="memo-list" id="memoListEl"></div>`;
  renderMemoList(section.querySelector("#memoListEl"), memos, expandedId);
  return section;
}

export function renderFavoritesView(memos, expandedId) {
  const section = document.createElement("div");
  section.innerHTML = `<p class="section-title">Favorites</p><div class="memo-list" id="memoListEl"></div>`;
  renderMemoList(section.querySelector("#memoListEl"), memos, expandedId);
  return section;
}

function formatDueDate(dueDate) {
  if (!dueDate) return "";
  const today = todayDateString();
  if (dueDate === today) return "Today";

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  if (dueDate === tomorrowStr) return "Tomorrow";

  const d = new Date(dueDate + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function renderTaskRow(task, isEditing) {
  const taskRefAttrs = `data-task-id="${escapeHtml(task.id)}" data-task-source="${escapeHtml(task.source)}" data-task-memo="${escapeHtml(task.memoId || "")}"`;

  if (isEditing) {
    return `
      <form class="task-row task-row-editing" ${taskRefAttrs}>
        <input type="text" class="task-edit-input" name="text" value="${escapeHtml(task.text)}" required />
        <div class="task-add-row">
          <input type="date" class="task-add-date" name="dueDate" value="${task.dueDate || ""}" />
          <select class="task-add-priority" name="priority">
            <option value="" ${!task.priority ? "selected" : ""}>No priority</option>
            <option value="low" ${task.priority === "low" ? "selected" : ""}>Low</option>
            <option value="medium" ${task.priority === "medium" ? "selected" : ""}>Medium</option>
            <option value="high" ${task.priority === "high" ? "selected" : ""}>High</option>
          </select>
          <button type="submit" class="task-add-submit">Save</button>
          <button type="button" class="task-add-cancel" data-action="cancel-edit-task">Cancel</button>
        </div>
      </form>
    `;
  }

  const today = todayDateString();
  const overdue = !task.done && !!task.dueDate && task.dueDate < today;

  return `
    <div class="task-row ${task.done ? "is-done" : ""} ${overdue ? "is-overdue" : ""}" ${taskRefAttrs}>
      <input type="checkbox" class="task-checkbox" data-action="toggle-task" ${task.done ? "checked" : ""} />
      <div class="task-row-body">
        <div class="task-row-main">
          <span class="task-row-text">${escapeHtml(task.text)}</span>
          ${task.priority ? `<span class="priority-badge priority-${task.priority}">${PRIORITY_LABELS[task.priority]}</span>` : ""}
        </div>
        ${task.dueDate || task.source === "memo" ? `
          <div class="task-row-meta">
            ${task.dueDate ? `<span class="task-due">${overdue ? "Overdue · " : ""}${formatDueDate(task.dueDate)}</span>` : ""}
            ${task.source === "memo" ? `<button class="task-row-source" data-open-memo="${escapeHtml(task.memoId)}">from “${escapeHtml(task.memoTitle)}”</button>` : ""}
          </div>
        ` : ""}
      </div>
      <div class="task-row-actions">
        <button class="task-icon-btn" data-action="edit-task" aria-label="Edit task">${icons.edit}</button>
        <button class="task-icon-btn" data-action="delete-task" aria-label="Delete task">${icons.trash}</button>
        <button class="task-icon-btn task-email-btn" disabled title="Draft in Gmail — coming soon">${icons.mail}</button>
      </div>
    </div>
  `;
}

export function renderTasksView(tasks, viewState) {
  const { filter = "all", editingTaskId = null, showAddForm = false } = viewState || {};
  const section = document.createElement("div");

  const filterTabsHtml = TASK_FILTERS.map(
    (f) => `<button class="task-filter-tab ${filter === f ? "active" : ""}" data-task-filter="${f}">${TASK_FILTER_LABELS[f]}</button>`
  ).join("");

  const addFormHtml = showAddForm ? `
    <form class="task-add-form" id="taskAddForm">
      <input type="text" class="task-add-input" name="text" placeholder="Add a task…" autofocus required />
      <div class="task-add-row">
        <input type="date" class="task-add-date" name="dueDate" />
        <select class="task-add-priority" name="priority">
          <option value="">No priority</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
        <button type="submit" class="task-add-submit">Add</button>
        <button type="button" class="task-add-cancel" data-action="cancel-add-task">Cancel</button>
      </div>
    </form>
  ` : "";

  const listHtml = tasks.length === 0
    ? `<div class="empty-state">${TASK_EMPTY_MESSAGES[filter] || TASK_EMPTY_MESSAGES.all}</div>`
    : `<div class="task-list">${tasks.map((task) => renderTaskRow(task, task.id === editingTaskId)).join("")}</div>`;

  section.innerHTML = `
    <div class="tasks-header">
      <p class="section-title">Tasks</p>
      <button class="task-add-toggle" data-action="${showAddForm ? "cancel-add-task" : "show-add-task"}">${showAddForm ? "Cancel" : "+ New task"}</button>
    </div>
    ${addFormHtml}
    <div class="task-filter-tabs">${filterTabsHtml}</div>
    ${listHtml}
  `;
  return section;
}

export function renderTopicsView(topics, activeTopic, memosForTopic, expandedId) {
  const section = document.createElement("div");

  if (activeTopic) {
    section.innerHTML = `
      <div class="topic-filter-banner">
        <span>Memos about <strong>${escapeHtml(activeTopic)}</strong></span>
        <button data-clear-topic>Clear</button>
      </div>
      <div class="memo-list" id="memoListEl"></div>
    `;
    renderMemoList(section.querySelector("#memoListEl"), memosForTopic, expandedId);
    return section;
  }

  if (topics.length === 0) {
    section.innerHTML = `<p class="section-title">Topics</p><div class="empty-state">Topics extracted from your memos will appear here.</div>`;
    return section;
  }

  section.innerHTML = `
    <p class="section-title">Topics</p>
    <div class="topics-grid">
      ${topics.map((topic) => `
        <button class="topic-card" data-topic="${escapeHtml(topic.name)}">
          <p class="topic-card-name">${escapeHtml(topic.name)}</p>
          <p class="topic-card-count">${topic.count} memo${topic.count === 1 ? "" : "s"}</p>
        </button>
      `).join("")}
    </div>
  `;
  return section;
}

export { escapeHtml, formatDuration };
