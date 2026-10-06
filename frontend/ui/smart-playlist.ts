import * as api from "../api";
import type { SmartPlaylistConfig, SmartPlaylistRule } from "../types";

/** A field a smart playlist rule can target. `type` drives the value input. */
interface FieldDef {
  label: string;
  type: "text" | "number" | "bool" | "lastPlayed";
  ops: string[];
}

const FIELDS: Record<string, FieldDef> = {
  title: { label: "Title", type: "text", ops: ["is", "contains", "startsWith", "endsWith"] },
  artist: { label: "Artist", type: "text", ops: ["is", "contains", "startsWith", "endsWith"] },
  album: { label: "Album", type: "text", ops: ["is", "contains", "startsWith", "endsWith"] },
  genre: { label: "Genre", type: "text", ops: ["is", "contains", "startsWith", "endsWith"] },
  year: { label: "Year", type: "number", ops: ["eq", "gt", "lt", "gte", "lte"] },
  duration: { label: "Duration (sec)", type: "number", ops: ["eq", "gt", "lt", "gte", "lte"] },
  playCount: { label: "Play count", type: "number", ops: ["eq", "gt", "lt", "gte", "lte"] },
  liked: { label: "Liked", type: "bool", ops: ["is"] },
  hasLyrics: { label: "Has lyrics", type: "bool", ops: ["is"] },
  lastPlayed: { label: "Last played", type: "lastPlayed", ops: ["withinDays", "never"] },
};

const OP_LABELS: Record<string, string> = {
  is: "is",
  contains: "contains",
  startsWith: "starts with",
  endsWith: "ends with",
  eq: "=",
  gt: ">",
  lt: "<",
  gte: "≥",
  lte: "≤",
  withinDays: "within last (days)",
  never: "never",
};

function fieldKeys(): string[] {
  return Object.keys(FIELDS);
}

function opLabel(op: string): string {
  return OP_LABELS[op] ?? op;
}

/** Render one rule row and wire its field/op/value controls. */
function renderRuleRow(
  container: HTMLElement,
  rule: SmartPlaylistRule,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "smart-playlist-rule-row";

  const fieldSelect = document.createElement("select");
  fieldSelect.className = "smart-playlist-rule-field";
  for (const key of fieldKeys()) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = FIELDS[key].label;
    fieldSelect.appendChild(opt);
  }
  fieldSelect.value = rule.field;

  const opSelect = document.createElement("select");
  opSelect.className = "smart-playlist-rule-op";

  const valueBox = document.createElement("div");
  valueBox.className = "smart-playlist-rule-value-box";

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "btn-secondary smart-playlist-rule-remove";
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", () => {
    row.remove();
  });

  const refreshOpAndValue = () => {
    const def = FIELDS[fieldSelect.value];
    opSelect.replaceChildren();
    for (const op of def.ops) {
      const opt = document.createElement("option");
      opt.value = op;
      opt.textContent = opLabel(op);
      opSelect.appendChild(opt);
    }
    opSelect.value = def.ops.includes(rule.op) ? rule.op : def.ops[0];
    refreshValue();
  };

  const refreshValue = () => {
    const def = FIELDS[fieldSelect.value];
    const op = opSelect.value;
    valueBox.replaceChildren();
    if (op === "never") {
      // No value needed.
      return;
    }
    if (def.type === "bool") {
      const sel = document.createElement("select");
      sel.className = "smart-playlist-rule-value";
      for (const v of ["true", "false"]) {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = v;
        sel.appendChild(opt);
      }
      sel.value = rule.value === "false" ? "false" : "true";
      valueBox.appendChild(sel);
      return;
    }
    const input = document.createElement("input");
    input.className = "smart-playlist-rule-value template-input";
    if (def.type === "number") {
      input.type = "number";
      input.step = "1";
    } else {
      input.type = "text";
    }
    input.value = rule.value;
    input.placeholder = def.type === "lastPlayed" ? "days" : "";
    valueBox.appendChild(input);
  };

  fieldSelect.addEventListener("change", () => {
    rule = { ...rule, field: fieldSelect.value };
    refreshOpAndValue();
  });
  opSelect.addEventListener("change", refreshValue);

  refreshOpAndValue();

  row.appendChild(fieldSelect);
  row.appendChild(opSelect);
  row.appendChild(valueBox);
  row.appendChild(removeBtn);
  container.appendChild(row);
  return row;
}

/** Read the current rule rows from the DOM. */
function readRules(container: HTMLElement): SmartPlaylistRule[] {
  const rules: SmartPlaylistRule[] = [];
  const rows = container.querySelectorAll<HTMLElement>(".smart-playlist-rule-row");
  rows.forEach((row) => {
    const field = row.querySelector<HTMLSelectElement>(".smart-playlist-rule-field")?.value;
    const op = row.querySelector<HTMLSelectElement>(".smart-playlist-rule-op")?.value;
    const valueEl = row.querySelector<HTMLInputElement | HTMLSelectElement>(
      ".smart-playlist-rule-value",
    );
    let value = valueEl && "value" in valueEl ? (valueEl as HTMLInputElement).value : "";
    if (!field) return;
    rules.push({ field, op: op ?? "is", value: value ?? "" });
  });
  return rules;
}

export interface OpenSmartPlaylistModalOptions {
  /** When set, edit the existing smart playlist instead of creating one. */
  playlistId?: string;
  name?: string;
  config?: SmartPlaylistConfig;
  /** Navigate to the playlist detail view after save. */
  openAfterSave?: boolean;
}

export interface SmartPlaylistModalSaveResult {
  playlistId: string;
  openAfterSave: boolean;
}

export function openSmartPlaylistModal(options: OpenSmartPlaylistModalOptions = {}): void {
  const modal = document.getElementById("smart-playlist-modal");
  const titleEl = document.getElementById("smart-playlist-modal-title");
  const nameInput = document.getElementById(
    "smart-playlist-name-input",
  ) as HTMLInputElement | null;
  const rulesEl = document.getElementById("smart-playlist-rules");
  const sortBySelect = document.getElementById(
    "smart-playlist-sort-by",
  ) as HTMLSelectElement | null;
  const sortOrderSelect = document.getElementById(
    "smart-playlist-sort-order",
  ) as HTMLSelectElement | null;
  const limitInput = document.getElementById(
    "smart-playlist-limit",
  ) as HTMLInputElement | null;
  if (!modal || !nameInput || !rulesEl || !sortBySelect || !sortOrderSelect || !limitInput) {
    return;
  }

  modal.dataset.playlistId = options.playlistId ?? "";
  modal.dataset.openAfterSave = options.openAfterSave ? "true" : "";
  if (titleEl) {
    titleEl.textContent = options.playlistId ? "Edit Smart Playlist" : "Create Smart Playlist";
  }
  nameInput.value = options.name ?? "";
  rulesEl.replaceChildren();
  const config = options.config ?? { rules: [] };
  const rules = config.rules.length > 0 ? config.rules : [emptyRule()];
  for (const rule of rules) {
    renderRuleRow(rulesEl, rule);
  }
  if (rulesEl.children.length === 0) {
    renderRuleRow(rulesEl, emptyRule());
  }
  sortBySelect.value = config.sortBy ?? "title";
  sortOrderSelect.value = config.sortOrder ?? "asc";
  limitInput.value = config.limit != null ? String(config.limit) : "";

  modal.classList.add("active");
  nameInput.focus();
}

function emptyRule(): SmartPlaylistRule {
  return { field: "artist", op: "contains", value: "" };
}

/** Wire the add-rule button and the save/cancel buttons once. Call once at boot. */
export function wireSmartPlaylistModal(
  onSaved: (result: SmartPlaylistModalSaveResult) => void,
): void {
  const modal = document.getElementById("smart-playlist-modal");
  const saveBtn = document.getElementById("smart-playlist-save");
  const cancelBtn = document.getElementById("smart-playlist-cancel");
  const addRuleBtn = document.getElementById("smart-playlist-add-rule");
  const nameInput = document.getElementById(
    "smart-playlist-name-input",
  ) as HTMLInputElement | null;
  const rulesEl = document.getElementById("smart-playlist-rules");
  const sortBySelect = document.getElementById(
    "smart-playlist-sort-by",
  ) as HTMLSelectElement | null;
  const sortOrderSelect = document.getElementById(
    "smart-playlist-sort-order",
  ) as HTMLSelectElement | null;
  const limitInput = document.getElementById(
    "smart-playlist-limit",
  ) as HTMLInputElement | null;
  if (!modal || !saveBtn || !nameInput || !rulesEl || !sortBySelect || !sortOrderSelect || !limitInput) {
    return;
  }

  addRuleBtn?.addEventListener("click", () => {
    renderRuleRow(rulesEl, emptyRule());
  });

  let saving = false;
  const close = () => {
    modal.classList.remove("active");
    delete modal.dataset.playlistId;
    delete modal.dataset.openAfterSave;
  };

  const submit = () => {
    if (saving) return;
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }
    const config: SmartPlaylistConfig = {
      rules: readRules(rulesEl),
      sortBy: sortBySelect.value || undefined,
      sortOrder: sortOrderSelect.value || undefined,
      limit: limitInput.value ? Number(limitInput.value) : undefined,
    };
    const playlistId = modal.dataset.playlistId || undefined;
    const openAfterSave = modal.dataset.openAfterSave === "true";
    saving = true;
    saveBtn.setAttribute("disabled", "true");
    void (async () => {
      try {
        const playlist =
          playlistId != null && playlistId !== ""
            ? await api.playlists.updateSmartPlaylist(playlistId, name, config)
            : await api.playlists.createSmartPlaylist(name, config);
        close();
        onSaved({ playlistId: playlist.id, openAfterSave });
      } finally {
        saving = false;
        saveBtn.removeAttribute("disabled");
      }
    })();
  };

  cancelBtn?.addEventListener("click", close);
  modal.querySelector(".modal-overlay")?.addEventListener("click", close);
  saveBtn.addEventListener("click", submit);
  nameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });
}

/** Load a smart playlist's config and open the editor for it. */
export async function openSmartPlaylistEditorFor(
  playlistId: string,
  name: string,
  openAfterSave: boolean,
): Promise<void> {
  let config: SmartPlaylistConfig | null = null;
  try {
    config = await api.playlists.getSmartPlaylistConfig(playlistId);
  } catch {
    config = null;
  }
  openSmartPlaylistModal({
    playlistId,
    name,
    config: config ?? { rules: [] },
    openAfterSave,
  });
}
