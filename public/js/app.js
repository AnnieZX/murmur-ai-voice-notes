import { store, buildMemoFromPipelineResult, memoMatchesQuery, filterTasks, sortTasks } from "./store.js";
import { VoiceRecorder } from "./recorder.js";
import { processAudio, speakText } from "./api.js";
import {
  renderGreetingAndDate,
  renderSidebarCounts,
  renderNavActive,
  renderRecentTopics,
  renderAllNotesView,
  renderFavoritesView,
  renderTasksView,
  renderTopicsView,
} from "./ui.js";

const state = {
  view: "all",
  searchQuery: "",
  expandedId: null,
  activeTopic: null,
  taskFilter: "all",
  editingTaskId: null,
  showAddTaskForm: false,
};

const el = {
  micButton: document.getElementById("micButton"),
  stopButton: document.getElementById("stopButton"),
  recorderStatus: document.getElementById("recorderStatus"),
  recorderPrompt: document.getElementById("recorderPrompt"),
  waveform: document.getElementById("waveform"),
  timer: document.getElementById("recorderTimer"),
  spinner: document.getElementById("recorderSpinner"),
  recorderError: document.getElementById("recorderError"),
  recorderErrorText: document.getElementById("recorderErrorText"),
  retryButton: document.getElementById("retryButton"),
  searchInput: document.getElementById("searchInput"),
  viewContainer: document.getElementById("viewContainer"),
};

const WAVEFORM_BAR_COUNT = 28;
let waveformBars = [];
let waveformHistory = new Array(WAVEFORM_BAR_COUNT).fill(0.06);
let lastRecordedBlob = null;
let lastRecordedDuration = null;

function buildWaveformBars() {
  el.waveform.innerHTML = "";
  waveformBars = [];
  for (let i = 0; i < WAVEFORM_BAR_COUNT; i++) {
    const bar = document.createElement("div");
    bar.className = "waveform-bar";
    el.waveform.appendChild(bar);
    waveformBars.push(bar);
  }
}

function updateWaveform(amplitude) {
  waveformHistory.push(amplitude);
  waveformHistory.shift();
  waveformBars.forEach((bar, i) => {
    bar.style.height = `${4 + waveformHistory[i] * 24}px`;
  });
}

function formatTimer(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const recorder = new VoiceRecorder({
  onAmplitude: updateWaveform,
  onTick: (seconds) => {
    el.timer.textContent = formatTimer(seconds);
  },
});

function setRecorderUI(uiState, message) {
  el.recorderError.hidden = true;

  const showWaveform = uiState === "recording";
  const showTimer = uiState === "recording";
  const showStop = uiState === "recording";
  const showSpinner = uiState === "uploading" || uiState === "processing";

  el.waveform.hidden = !showWaveform;
  el.timer.hidden = !showTimer;
  el.stopButton.hidden = !showStop;
  el.spinner.hidden = !showSpinner;

  el.micButton.classList.toggle("is-recording", uiState === "recording");
  el.micButton.disabled = uiState === "uploading" || uiState === "processing";

  const prompts = {
    idle: "What's on your mind?",
    recording: "Listening…",
    uploading: "What's on your mind?",
    processing: "What's on your mind?",
    completed: "What's on your mind?",
    error: "What's on your mind?",
  };
  el.recorderPrompt.textContent = prompts[uiState] || prompts.idle;

  const statuses = {
    idle: "Tap the microphone to start a memo.",
    recording: "Recording — tap stop when you're done.",
    uploading: "Uploading your recording…",
    processing: "Transcribing and analyzing your memo…",
    completed: "Memo saved.",
    error: "Something went wrong.",
  };
  el.recorderStatus.textContent = message || statuses[uiState] || "";
  el.recorderStatus.classList.toggle("is-error", uiState === "error");
}

async function startRecording() {
  try {
    setRecorderUI("recording");
    buildWaveformBars();
    waveformHistory = new Array(WAVEFORM_BAR_COUNT).fill(0.06);
    el.timer.textContent = "0:00";
    await recorder.start();
  } catch (err) {
    setRecorderUI("error", "Microphone access failed: " + err.message);
  }
}

async function stopRecordingAndProcess() {
  const result = await recorder.stop();
  if (!result) return;

  lastRecordedBlob = result.blob;
  lastRecordedDuration = result.durationSeconds;

  await submitRecording(result.blob, result.durationSeconds);
}

async function submitRecording(blob, durationSeconds) {
  setRecorderUI("uploading");
  try {
    setRecorderUI("processing");
    const result = await processAudio(blob);
    const memo = buildMemoFromPipelineResult(result, durationSeconds);
    store.add(memo);

    setRecorderUI("completed");
    state.view = "all";
    state.expandedId = memo.id;
    render();

    setTimeout(() => {
      if (!el.recorderError || el.recorderError.hidden) setRecorderUI("idle");
    }, 2000);
  } catch (err) {
    setRecorderUI("error", err.message || "Processing failed.");
    el.recorderError.hidden = false;
    el.recorderErrorText.textContent = err.message || "Processing failed.";
  }
}

el.micButton.addEventListener("click", () => {
  if (recorder.isRecording) return;
  startRecording();
});

el.stopButton.addEventListener("click", () => {
  stopRecordingAndProcess();
});

el.retryButton.addEventListener("click", () => {
  el.recorderError.hidden = true;
  if (lastRecordedBlob) {
    submitRecording(lastRecordedBlob, lastRecordedDuration);
  } else {
    setRecorderUI("idle");
  }
});

el.searchInput.addEventListener("input", (e) => {
  state.searchQuery = e.target.value;
  render();
});

function setView(view) {
  state.view = view;
  state.activeTopic = null;
  state.expandedId = null;
  state.editingTaskId = null;
  state.showAddTaskForm = false;
  render();
}

document.querySelectorAll("[data-view]").forEach((btn) => {
  btn.addEventListener("click", () => setView(btn.dataset.view));
});

function setTopicFilter(topicName) {
  state.view = "topics";
  state.activeTopic = topicName;
  state.expandedId = null;
  render();
}

function getFilteredMemos(memos) {
  return memos.filter((m) => memoMatchesQuery(m, state.searchQuery));
}

async function handleListen(memo, button) {
  const originalHtml = button.innerHTML;
  button.disabled = true;
  button.textContent = "Loading…";
  try {
    const { audio_base64 } = await speakText(memo.summary || memo.transcript);
    const audio = new Audio(`data:audio/mp3;base64,${audio_base64}`);
    await audio.play();
  } catch (err) {
    console.error("Murmur: listen failed", err);
    alert("Could not play the summary audio: " + err.message);
  } finally {
    button.disabled = false;
    button.innerHTML = originalHtml;
  }
}

function wireViewContainerEvents() {
  el.viewContainer.addEventListener("click", async (e) => {
    const favBtn = e.target.closest('[data-action="favorite"]');
    if (favBtn) {
      e.stopPropagation();
      const card = e.target.closest("[data-memo-id]");
      store.toggleFavorite(card.dataset.memoId);
      render();
      return;
    }

    const copyBtn = e.target.closest('[data-action="copy"]');
    if (copyBtn) {
      e.stopPropagation();
      const card = e.target.closest("[data-memo-id]");
      const memo = store.get(card.dataset.memoId);
      try {
        await navigator.clipboard.writeText(memo.transcript || "");
        const original = copyBtn.textContent;
        copyBtn.textContent = "Copied";
        setTimeout(() => (copyBtn.textContent = original), 1200);
      } catch (_) {
        alert("Copy failed — clipboard access was denied.");
      }
      return;
    }

    const deleteBtn = e.target.closest('[data-action="delete"]');
    if (deleteBtn) {
      e.stopPropagation();
      const card = e.target.closest("[data-memo-id]");
      if (confirm("Delete this memo? This can't be undone.")) {
        store.remove(card.dataset.memoId);
        if (state.expandedId === card.dataset.memoId) state.expandedId = null;
        render();
      }
      return;
    }

    const listenBtn = e.target.closest('[data-action="listen"]');
    if (listenBtn) {
      e.stopPropagation();
      const card = e.target.closest("[data-memo-id]");
      const memo = store.get(card.dataset.memoId);
      handleListen(memo, listenBtn);
      return;
    }

    const topicTag = e.target.closest("[data-topic]");
    if (topicTag) {
      e.stopPropagation();
      setTopicFilter(topicTag.dataset.topic);
      return;
    }

    const clearTopic = e.target.closest("[data-clear-topic]");
    if (clearTopic) {
      state.activeTopic = null;
      render();
      return;
    }

    const openMemo = e.target.closest("[data-open-memo]");
    if (openMemo) {
      state.view = "all";
      state.expandedId = openMemo.dataset.openMemo;
      render();
      return;
    }

    const filterTab = e.target.closest("[data-task-filter]");
    if (filterTab) {
      state.taskFilter = filterTab.dataset.taskFilter;
      state.editingTaskId = null;
      render();
      return;
    }

    const showAddTaskBtn = e.target.closest('[data-action="show-add-task"]');
    if (showAddTaskBtn) {
      state.showAddTaskForm = true;
      state.editingTaskId = null;
      render();
      return;
    }

    const cancelAddTaskBtn = e.target.closest('[data-action="cancel-add-task"]');
    if (cancelAddTaskBtn) {
      state.showAddTaskForm = false;
      render();
      return;
    }

    const editTaskBtn = e.target.closest('[data-action="edit-task"]');
    if (editTaskBtn) {
      const row = e.target.closest("[data-task-id]");
      state.editingTaskId = row.dataset.taskId;
      state.showAddTaskForm = false;
      render();
      return;
    }

    const cancelEditTaskBtn = e.target.closest('[data-action="cancel-edit-task"]');
    if (cancelEditTaskBtn) {
      state.editingTaskId = null;
      render();
      return;
    }

    const deleteTaskBtn = e.target.closest('[data-action="delete-task"]');
    if (deleteTaskBtn) {
      const row = e.target.closest("[data-task-id]");
      if (confirm("Delete this task? This can't be undone.")) {
        store.deleteTask({
          id: row.dataset.taskId,
          source: row.dataset.taskSource,
          memoId: row.dataset.taskMemo || null,
        });
        if (state.editingTaskId === row.dataset.taskId) state.editingTaskId = null;
        render();
      }
      return;
    }

    const card = e.target.closest("[data-memo-id]");
    if (card && !e.target.closest("button") && !e.target.closest("input")) {
      state.expandedId = state.expandedId === card.dataset.memoId ? null : card.dataset.memoId;
      render();
    }
  });

  el.viewContainer.addEventListener("change", (e) => {
    const taskToggle = e.target.closest('[data-action="toggle-task"]');
    if (taskToggle) {
      const row = e.target.closest("[data-task-id]");
      store.toggleTaskDone({
        id: row.dataset.taskId,
        source: row.dataset.taskSource,
        memoId: row.dataset.taskMemo || null,
      });
      render();
      return;
    }

    const checkbox = e.target.closest("[data-task-toggle]");
    if (!checkbox) return;
    const itemId = checkbox.dataset.taskToggle;
    const memoId = checkbox.dataset.taskMemo || e.target.closest("[data-memo-id]")?.dataset.memoId;
    if (memoId) {
      store.toggleActionItem(memoId, itemId);
      render();
    }
  });

  el.viewContainer.addEventListener("submit", (e) => {
    const addForm = e.target.closest("#taskAddForm");
    if (addForm) {
      e.preventDefault();
      const formData = new FormData(addForm);
      const text = (formData.get("text") || "").toString().trim();
      if (!text) return;
      store.addTask({
        text,
        dueDate: formData.get("dueDate") || null,
        priority: formData.get("priority") || null,
      });
      state.showAddTaskForm = false;
      state.taskFilter = "all";
      render();
      return;
    }

    const editForm = e.target.closest(".task-row-editing");
    if (editForm) {
      e.preventDefault();
      const formData = new FormData(editForm);
      const text = (formData.get("text") || "").toString().trim();
      if (!text) return;
      store.updateTask(
        {
          id: editForm.dataset.taskId,
          source: editForm.dataset.taskSource,
          memoId: editForm.dataset.taskMemo || null,
        },
        {
          text,
          dueDate: formData.get("dueDate") || null,
          priority: formData.get("priority") || null,
        }
      );
      state.editingTaskId = null;
      render();
    }
  });
}

function render() {
  const allMemos = store.list();
  const filtered = getFilteredMemos(allMemos);
  const topics = store.allTopics();
  const tasks = store.allTasks();

  renderSidebarCounts({ memos: allMemos, tasks, topics });
  renderNavActive(state.view);
  renderRecentTopics(topics, setTopicFilter);

  el.viewContainer.innerHTML = "";

  if (state.view === "all") {
    el.viewContainer.appendChild(renderAllNotesView(filtered, state.expandedId));
  } else if (state.view === "favorites") {
    el.viewContainer.appendChild(renderFavoritesView(filtered.filter((m) => m.favorite), state.expandedId));
  } else if (state.view === "tasks") {
    const visibleTasks = sortTasks(filterTasks(tasks, state.taskFilter));
    el.viewContainer.appendChild(renderTasksView(visibleTasks, {
      filter: state.taskFilter,
      editingTaskId: state.editingTaskId,
      showAddForm: state.showAddTaskForm,
    }));
  } else if (state.view === "topics") {
    const memosForTopic = state.activeTopic
      ? filtered.filter((m) => (m.topics || []).includes(state.activeTopic))
      : [];
    el.viewContainer.appendChild(renderTopicsView(topics, state.activeTopic, memosForTopic, state.expandedId));
  }
}

function init() {
  renderGreetingAndDate();
  setRecorderUI("idle");
  wireViewContainerEvents();
  render();
}

init();
