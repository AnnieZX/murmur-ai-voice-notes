// Persistence + deterministic enrichment for memos.
// No backend/database is introduced here — memo history lives in localStorage,
// per the portfolio-scope decision to avoid new infrastructure.

const STORAGE_KEY = "murmur:memos:v1";
const TASKS_STORAGE_KEY = "murmur:manualTasks:v1";

// Heuristic, deterministic action-item detector. Azure AI Language (as configured
// in this project) does not provide action-item extraction, so this is plain
// phrase-pattern matching over the transcript rather than an Azure capability.
// It is intentionally conservative and will miss/over-match some phrasing —
// surfaced to the user as a labeled limitation in the UI/README.
const ACTION_PATTERNS = [
  /\b(need|needs|needed) to\b/i,
  /\bhave to\b/i,
  /\bhas to\b/i,
  /\bremember to\b/i,
  /\bdon'?t forget to\b/i,
  /\bremind me to\b/i,
  /\bmake sure (to|i|we)\b/i,
  /\bshould\b/i,
  /\bmust\b/i,
  /\bto[- ]do\b/i,
  /\bfollow up\b/i,
  /\bi'?ll\b/i,
  /\bi will\b/i,
  /\bwe need\b/i,
  /\blet'?s\b/i,
  /\bschedule\b/i,
];

function splitSentences(text) {
  return (text || "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function extractActionItems(transcript) {
  const sentences = splitSentences(transcript);
  const items = [];

  for (const sentence of sentences) {
    if (ACTION_PATTERNS.some((pattern) => pattern.test(sentence))) {
      items.push(sentence);
    }
  }

  return items;
}

export function deriveTitle(transcript) {
  const sentences = splitSentences(transcript);
  const first = sentences[0] || transcript || "";
  const trimmed = first.trim();
  if (!trimmed) return "Untitled memo";
  return trimmed.length > 70 ? trimmed.slice(0, 67).trimEnd() + "…" : trimmed;
}

function makeId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `memo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function buildMemoFromPipelineResult(result, durationSeconds) {
  const transcript = result.transcript || "";
  const topics = Array.isArray(result.key_phrases) ? [...new Set(result.key_phrases)] : [];

  return {
    id: makeId(),
    createdAt: Date.now(),
    durationSeconds: durationSeconds ?? result.duration_seconds ?? null,
    transcript,
    language: result.language || "en-US",
    confidence: typeof result.confidence === "number" ? result.confidence : null,
    summary: result.summary_text || "",
    topics,
    entities: Array.isArray(result.entities) ? result.entities : [],
    sentiment: result.sentiment || null,
    actionItems: extractActionItems(transcript).map((text) => ({
      id: makeId(),
      text,
      done: false,
    })),
    favorite: false,
    title: deriveTitle(transcript),
  };
}

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function writeAll(memos) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memos));
    return true;
  } catch (err) {
    console.error("Murmur: failed to save memo history locally.", err);
    return false;
  }
}

// Manually-created tasks aren't attached to any memo, so they live in their
// own localStorage entry alongside memo-derived action items rather than in
// the memos array.
function readManualTasks() {
  try {
    const raw = localStorage.getItem(TASKS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function writeManualTasks(tasks) {
  try {
    localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks));
    return true;
  } catch (err) {
    console.error("Murmur: failed to save tasks locally.", err);
    return false;
  }
}

export function todayDateString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const PRIORITY_WEIGHT = { high: 0, medium: 1, low: 2 };

// Filters operate on due date (plain "YYYY-MM-DD" strings, which sort
// lexically the same as chronologically) and completion state only — never
// on fields extracted memos don't actually have.
export function filterTasks(tasks, filter) {
  const today = todayDateString();
  switch (filter) {
    case "today":
      return tasks.filter((t) => !t.done && t.dueDate && t.dueDate <= today);
    case "upcoming":
      return tasks.filter((t) => !t.done && t.dueDate && t.dueDate > today);
    case "completed":
      return tasks.filter((t) => t.done);
    default:
      return tasks;
  }
}

// Incomplete tasks surface above completed ones; among incomplete tasks,
// soonest/overdue due dates lead, then undated tasks ordered by priority.
export function sortTasks(tasks) {
  return [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.done && b.done) return b.createdAt - a.createdAt;

    if (a.dueDate && b.dueDate) {
      if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    } else if (a.dueDate && !b.dueDate) {
      return -1;
    } else if (!a.dueDate && b.dueDate) {
      return 1;
    }

    const aPriority = PRIORITY_WEIGHT[a.priority] ?? 3;
    const bPriority = PRIORITY_WEIGHT[b.priority] ?? 3;
    if (aPriority !== bPriority) return aPriority - bPriority;

    return b.createdAt - a.createdAt;
  });
}

export const store = {
  list() {
    return readAll().sort((a, b) => b.createdAt - a.createdAt);
  },

  get(id) {
    return readAll().find((m) => m.id === id) || null;
  },

  add(memo) {
    const memos = readAll();
    memos.push(memo);
    writeAll(memos);
    return memo;
  },

  update(id, patch) {
    const memos = readAll();
    const idx = memos.findIndex((m) => m.id === id);
    if (idx === -1) return null;
    memos[idx] = { ...memos[idx], ...patch };
    writeAll(memos);
    return memos[idx];
  },

  remove(id) {
    const memos = readAll().filter((m) => m.id !== id);
    writeAll(memos);
  },

  toggleFavorite(id) {
    const memo = this.get(id);
    if (!memo) return null;
    return this.update(id, { favorite: !memo.favorite });
  },

  toggleActionItem(memoId, itemId) {
    const memo = this.get(memoId);
    if (!memo) return null;
    const actionItems = (memo.actionItems || []).map((item) =>
      item.id === itemId ? { ...item, done: !item.done } : item
    );
    return this.update(memoId, { actionItems });
  },

  allTopics() {
    const counts = new Map();
    for (const memo of readAll()) {
      for (const topic of memo.topics || []) {
        counts.set(topic, (counts.get(topic) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  },

  // Merges memo-extracted action items with manually-created tasks into one
  // normalized shape. `source`/`memoId` tell updateTask/deleteTask/
  // toggleTaskDone which backing store a given task actually lives in.
  allTasks() {
    const tasks = [];
    for (const memo of readAll()) {
      for (const item of memo.actionItems || []) {
        tasks.push({
          id: item.id,
          text: item.text,
          done: item.done,
          dueDate: item.dueDate || null,
          priority: item.priority || null,
          source: "memo",
          memoId: memo.id,
          memoTitle: memo.title,
          createdAt: memo.createdAt,
        });
      }
    }
    for (const task of readManualTasks()) {
      tasks.push({
        id: task.id,
        text: task.text,
        done: task.done,
        dueDate: task.dueDate || null,
        priority: task.priority || null,
        source: "manual",
        memoId: null,
        memoTitle: null,
        createdAt: task.createdAt,
      });
    }
    return tasks;
  },

  addTask({ text, dueDate, priority }) {
    const task = {
      id: makeId(),
      text: (text || "").trim(),
      done: false,
      dueDate: dueDate || null,
      priority: priority || null,
      createdAt: Date.now(),
    };
    const tasks = readManualTasks();
    tasks.push(task);
    writeManualTasks(tasks);
    return task;
  },

  // `taskRef` is { id, source, memoId } as produced by allTasks() — enough
  // to locate the record in whichever store it actually lives in.
  updateTask(taskRef, patch) {
    if (taskRef.source === "manual") {
      const tasks = readManualTasks();
      const idx = tasks.findIndex((t) => t.id === taskRef.id);
      if (idx === -1) return null;
      tasks[idx] = { ...tasks[idx], ...patch };
      writeManualTasks(tasks);
      return tasks[idx];
    }
    const memo = this.get(taskRef.memoId);
    if (!memo) return null;
    const actionItems = (memo.actionItems || []).map((item) =>
      item.id === taskRef.id ? { ...item, ...patch } : item
    );
    this.update(taskRef.memoId, { actionItems });
    return actionItems.find((item) => item.id === taskRef.id) || null;
  },

  deleteTask(taskRef) {
    if (taskRef.source === "manual") {
      writeManualTasks(readManualTasks().filter((t) => t.id !== taskRef.id));
      return;
    }
    const memo = this.get(taskRef.memoId);
    if (!memo) return;
    const actionItems = (memo.actionItems || []).filter((item) => item.id !== taskRef.id);
    this.update(taskRef.memoId, { actionItems });
  },

  toggleTaskDone(taskRef) {
    if (taskRef.source === "manual") {
      const tasks = readManualTasks();
      const idx = tasks.findIndex((t) => t.id === taskRef.id);
      if (idx === -1) return null;
      tasks[idx] = { ...tasks[idx], done: !tasks[idx].done };
      writeManualTasks(tasks);
      return tasks[idx];
    }
    return this.toggleActionItem(taskRef.memoId, taskRef.id);
  },
};

export function memoMatchesQuery(memo, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  const haystacks = [
    memo.transcript,
    memo.summary,
    ...(memo.topics || []),
    ...(memo.actionItems || []).map((i) => i.text),
  ];
  return haystacks.some((h) => (h || "").toLowerCase().includes(q));
}
