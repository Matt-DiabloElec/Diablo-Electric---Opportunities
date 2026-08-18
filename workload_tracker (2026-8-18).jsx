import { useState, useEffect, useCallback, useRef } from "react";
import {
  Mail, Plus, Trash2, ChevronDown, ChevronRight, Users, LayoutGrid,
  Gauge, Check, X, Upload, Pencil, AlertTriangle, Search, Loader2, RotateCw, Calendar, ListChecks
} from "lucide-react";

/* ---------------------------------- Tokens ---------------------------------- */

const COLORS = {
  bg: "#F6F7F4",
  surface: "#FFFFFF",
  surfaceAlt: "#EEF1EC",
  ink: "#1C2530",
  inkSoft: "#5B6772",
  inkFaint: "#8A949C",
  line: "#DBDFDA",
  primary: "#1E3A5F",
  primarySoft: "#E9EFF5",
  accent: "#DA9A32",
  accentSoft: "#FBF1DC",
  danger: "#B94A3E",
  dangerSoft: "#FAEAE7",
  success: "#3D7A5C",
  successSoft: "#E7F2EC",
};

const FONT_DISPLAY = "'Space Grotesk', 'IBM Plex Sans', sans-serif";
const FONT_BODY = "'IBM Plex Sans', system-ui, sans-serif";
const FONT_MONO = "'IBM Plex Mono', 'SF Mono', monospace";

const STATUS_META = {
  overdue: { label: "Overdue", color: COLORS.danger, bg: COLORS.dangerSoft, icon: AlertTriangle },
  duesoon: { label: "Due soon", color: COLORS.accent, bg: COLORS.accentSoft, icon: null },
  ontrack: { label: "On track", color: COLORS.primary, bg: COLORS.primarySoft, icon: null },
  complete: { label: "Complete", color: COLORS.success, bg: COLORS.successSoft, icon: Check },
  none: { label: "No due date", color: COLORS.inkFaint, bg: COLORS.surfaceAlt, icon: null },
};

/* ---------------------------------- Helpers ---------------------------------- */

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtTime(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(2000, 0, 1, h, m);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return parts.slice(0, 2).map((w) => w[0] || "").join("").toUpperCase();
}

function getStatus(opp) {
  const total = opp.tasks.length;
  const done = opp.tasks.filter((t) => t.done).length;
  if (total > 0 && done === total) return "complete";
  if (!opp.dueDate) return "none";
  const due = new Date(opp.dueDate + "T23:59:59");
  const diffDays = (due - new Date()) / 86400000;
  if (diffDays < 0) return "overdue";
  if (diffDays <= 3) return "duesoon";
  return "ontrack";
}

function isTaskOverdue(task) {
  if (task.done || !task.dueDate) return false;
  const due = new Date(task.dueDate + "T23:59:59");
  return due < new Date();
}

const DEFAULT_TEMPLATES = [
  { id: "tpl-jobwalk", description: "Attend Job Walk", mode: "manual", offsetValue: 0, offsetUnit: "days", anchor: "before" },
  { id: "tpl-lighting", description: "Request Lighting Quote", mode: "offset", offsetValue: 1, offsetUnit: "weeks", anchor: "before" },
  { id: "tpl-switchgear", description: "Request Switchgear Quote", mode: "offset", offsetValue: 1, offsetUnit: "weeks", anchor: "before" },
  { id: "tpl-rfi", description: "Submit RFIs", mode: "offset", offsetValue: 5, offsetUnit: "days", anchor: "before" },
  { id: "tpl-sow", description: "Submit Scope of Work to Estimator", mode: "offset", offsetValue: 1, offsetUnit: "days", anchor: "before" },
  { id: "tpl-bid", description: "Submit Bid", mode: "offset", offsetValue: 1, offsetUnit: "hours", anchor: "before" },
];

function computeTemplateDate(opp, tpl) {
  if (tpl.mode !== "offset" || !opp.dueDate) return { dueDate: "", dueTime: "", imprecise: false };
  const needsTime = tpl.offsetUnit === "hours";
  const baseTime = opp.dueTime || "17:00";
  const [y, m, d] = opp.dueDate.split("-").map(Number);
  const [bh, bm] = baseTime.split(":").map(Number);
  const base = new Date(y, m - 1, d, bh, bm);
  const mult = tpl.offsetUnit === "hours" ? 3600000 : tpl.offsetUnit === "days" ? 86400000 : 604800000;
  const sign = tpl.anchor === "after" ? 1 : -1;
  const result = new Date(base.getTime() + sign * tpl.offsetValue * mult);
  const dueDate = `${result.getFullYear()}-${String(result.getMonth() + 1).padStart(2, "0")}-${String(result.getDate()).padStart(2, "0")}`;
  const dueTime = needsTime ? `${String(result.getHours()).padStart(2, "0")}:${String(result.getMinutes()).padStart(2, "0")}` : "";
  return { dueDate, dueTime, imprecise: needsTime && !opp.dueTime };
}

function buildTemplateTasks(opp, templates) {
  return templates.map((tpl) => {
    if (tpl.mode === "manual") {
      return { id: genId(), description: tpl.description, assignee: "", dueDate: "", dueTime: "", done: false };
    }
    const { dueDate, dueTime } = computeTemplateDate(opp, tpl);
    return { id: genId(), description: tpl.description, assignee: "", dueDate, dueTime, done: false };
  });
}

/* ---------------------------------- Calendar (.ics) ---------------------------------- */

function pad2(n) { return String(n).padStart(2, "0"); }

function toICSDateTime(date) {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}T${pad2(date.getHours())}${pad2(date.getMinutes())}00`;
}

function eventTitle(oppName, taskDescription, date) {
  const weekday = date.toLocaleDateString("en-US", { weekday: "short" });
  const md = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${taskDescription} — ${oppName} (${weekday} ${md}, ${time})`;
}

function buildICS(events) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Opportunity Board//EN", "CALSCALE:GREGORIAN"];
  events.forEach((ev) => {
    const end = new Date(ev.start.getTime() + ev.durationMinutes * 60000);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${genId()}@opportunity-board`,
      `DTSTAMP:${toICSDateTime(new Date())}Z`,
      `DTSTART:${toICSDateTime(ev.start)}`,
      `DTEND:${toICSDateTime(end)}`,
      `SUMMARY:${ev.title}`,
      "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Reminder", "TRIGGER:-P1D", "END:VALARM",
      "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Reminder", "TRIGGER:-PT2H", "END:VALARM",
      "END:VEVENT"
    );
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

function downloadICS(filename, content) {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function matchMemberByName(name, team) {
  if (!name) return "";
  const lower = name.toLowerCase().trim();
  const exact = team.find((m) => m.name.toLowerCase() === lower);
  if (exact) return exact.id;
  const partial = team.find(
    (m) => m.name.toLowerCase().includes(lower) || lower.includes(m.name.toLowerCase())
  );
  return partial ? partial.id : "";
}

/* ---------------------------------- Storage ---------------------------------- */

async function loadState() {
  let team = [];
  let opps = [];
  let templates = null;
  if (typeof window !== "undefined" && window.storage) {
    try {
      const t = await window.storage.get("team-members", true);
      if (t && t.value) team = JSON.parse(t.value);
    } catch (e) { /* first run, nothing saved yet */ }
    try {
      const o = await window.storage.get("opportunities", true);
      if (o && o.value) opps = JSON.parse(o.value);
    } catch (e) { /* first run, nothing saved yet */ }
    try {
      const tpl = await window.storage.get("task-templates", true);
      templates = tpl && tpl.value ? JSON.parse(tpl.value) : [];
    } catch (e) {
      templates = null; /* never saved — caller should seed defaults */
    }
  } else {
    templates = [];
  }
  return { team, opps, templates };
}

async function persist(key, value) {
  if (typeof window === "undefined" || !window.storage) throw new Error("storage unavailable");
  const res = await window.storage.set(key, JSON.stringify(value), true);
  if (!res) throw new Error("save failed");
}

/* ---------------------------------- AI extraction ---------------------------------- */

async function extractFromEmail(emailText, team) {
  const roster = team.length
    ? team.map((m) => `${m.name} — ${m.specialty || "General"}`).join("\n")
    : "(no team members added yet)";
  const system = `Today's date is ${new Date().toISOString().slice(0, 10)}. You read construction/electrical-estimating project emails and pull out structured data for a workload tracker. Respond with ONLY valid JSON, no markdown fences, no commentary, matching exactly this shape:
{"opportunityName": string, "client": string or null, "dueDate": "YYYY-MM-DD" or null, "tasks": [{"description": string, "suggestedAssigneeName": string or null, "reason": string, "dueDate": "YYYY-MM-DD" or null, "dueTime": "HH:MM" (24-hour) or null}]}

Team roster (name — specialty):
${roster}

For each task, suggest the roster member whose specialty best fits it. If nothing fits well, or the roster is empty, use null. Keep task descriptions short, specific, and actionable (e.g. "Take off lighting fixtures", "Confirm panel schedule with GC", "Submit RFI on mechanical connection"). If the email doesn't spell out next steps explicitly, infer 3-8 typical bid/estimate follow-up tasks from what it implies still needs to happen. The top-level "dueDate" is the overall bid/opportunity deadline; a task's own "dueDate" is only an interim deadline for that specific task (e.g. "get me the lighting count by Friday"). Resolve relative dates ("Friday", "end of week") against today's date above. Only set "dueTime" when the email states an actual clock time for that task. Leave any date or time null rather than guessing.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system,
      messages: [{ role: "user", content: emailText }],
    }),
  });
  if (!response.ok) throw new Error("Request failed (" + response.status + ")");
  const data = await response.json();
  const block = (data.content || []).find((b) => b.type === "text");
  if (!block) throw new Error("No response text");
  const cleaned = block.text.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

/* ---------------------------------- Small UI atoms ---------------------------------- */

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.none;
  const Icon = meta.icon;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium shrink-0"
      style={{ background: meta.bg, color: meta.color, fontFamily: FONT_BODY }}
    >
      {Icon && <Icon size={12} strokeWidth={2.5} />}
      {meta.label}
    </span>
  );
}

function Avatar({ member, size = 26 }) {
  if (!member) return null;
  return (
    <span
      title={member.name + (member.specialty ? " — " + member.specialty : "")}
      className="inline-flex items-center justify-center rounded-full shrink-0 font-semibold"
      style={{
        width: size, height: size, background: COLORS.primarySoft, color: COLORS.primary,
        fontFamily: FONT_MONO, fontSize: size * 0.38, border: `1px solid ${COLORS.line}`,
      }}
    >
      {initials(member.name)}
    </span>
  );
}

function Button({ children, onClick, variant = "primary", icon: Icon, small, type = "button", disabled }) {
  const styles = {
    primary: { background: COLORS.primary, color: "#fff", border: `1px solid ${COLORS.primary}` },
    ghost: { background: "transparent", color: COLORS.ink, border: `1px solid ${COLORS.line}` },
    accent: { background: COLORS.accent, color: "#fff", border: `1px solid ${COLORS.accent}` },
    danger: { background: "transparent", color: COLORS.danger, border: `1px solid ${COLORS.dangerSoft}` },
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-lg font-medium transition-opacity hover:opacity-85 disabled:opacity-50 ${small ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm"}`}
      style={{ ...styles[variant], fontFamily: FONT_BODY }}
    >
      {Icon && <Icon size={small ? 13 : 15} />}
      {children}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <label className="block mb-3">
      <span className="block text-xs font-semibold mb-1" style={{ color: COLORS.inkSoft, fontFamily: FONT_MONO, letterSpacing: "0.03em" }}>
        {label.toUpperCase()}
      </span>
      {children}
    </label>
  );
}

const inputStyle = {
  fontFamily: FONT_BODY, border: `1px solid ${COLORS.line}`, background: COLORS.surface, color: COLORS.ink,
};

/* ---------------------------------- Modal shell ---------------------------------- */

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto" style={{ background: "rgba(28,37,48,0.45)" }}>
      <div
        className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} rounded-2xl shadow-xl my-6`}
        style={{ background: COLORS.surface, border: `1px solid ${COLORS.line}` }}
      >
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${COLORS.line}` }}>
          <h2 style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:opacity-60" style={{ color: COLORS.inkSoft }}>
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/* ---------------------------------- Opportunity form modal ---------------------------------- */

function OppFormModal({ team, existing, onSave, onClose }) {
  const [name, setName] = useState(existing?.name || "");
  const [client, setClient] = useState(existing?.client || "");
  const [owner, setOwner] = useState(existing?.owner || "");
  const [helpers, setHelpers] = useState(existing?.helpers || []);
  const [dueDate, setDueDate] = useState(existing?.dueDate || "");
  const [dueTime, setDueTime] = useState(existing?.dueTime || "");
  const [applyTemplates, setApplyTemplates] = useState(true);

  const toggleHelper = (id) => {
    setHelpers((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id]));
  };

  return (
    <Modal title={existing ? "Edit opportunity" : "New opportunity"} onClose={onClose}>
      <Field label="Name">
        <input className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 1330 Broadway Suite 604" />
      </Field>
      <Field label="Client / GC">
        <input className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle} value={client} onChange={(e) => setClient(e.target.value)} placeholder="e.g. DivcoWest" />
      </Field>
      <Field label="Owner">
        <select className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle} value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">Unassigned</option>
          {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </Field>
      <Field label="Helping">
        <div className="flex flex-wrap gap-1.5">
          {team.length === 0 && <span className="text-xs" style={{ color: COLORS.inkFaint }}>Add team members first, on the Team tab.</span>}
          {team.map((m) => (
            <button
              key={m.id} type="button" onClick={() => toggleHelper(m.id)}
              className="px-2.5 py-1 rounded-full text-xs font-medium border"
              style={helpers.includes(m.id)
                ? { background: COLORS.primary, color: "#fff", borderColor: COLORS.primary }
                : { background: COLORS.surface, color: COLORS.inkSoft, borderColor: COLORS.line }}
            >
              {m.name}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Bid due">
        <div className="flex gap-2">
          <input type="date" className="flex-1 rounded-lg px-3 py-2 text-sm" style={inputStyle} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          <input type="time" className="rounded-lg px-3 py-2 text-sm" style={{ ...inputStyle, width: 130 }} value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
        </div>
        <span className="block text-xs mt-1" style={{ color: COLORS.inkFaint, fontFamily: FONT_BODY }}>Time is optional, but needed for hour-based checklist items like "Submit Bid."</span>
      </Field>
      {!existing && (
        <label className="flex items-center gap-2 text-xs mb-3" style={{ color: COLORS.inkSoft, fontFamily: FONT_BODY }}>
          <input type="checkbox" checked={applyTemplates} onChange={(e) => setApplyTemplates(e.target.checked)} />
          Add the standard task checklist
        </label>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!name.trim()}
          onClick={() => onSave({ name: name.trim(), client: client.trim(), owner, helpers, dueDate, dueTime, ...(existing ? {} : { applyTemplates }) })}
        >
          {existing ? "Save changes" : "Create opportunity"}
        </Button>
      </div>
    </Modal>
  );
}

/* ---------------------------------- Import-from-email modal ---------------------------------- */

function ImportModal({ team, opps, onClose, onConfirm }) {
  const [emailText, setEmailText] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [status, setStatus] = useState("input"); // input | extracting | review | error
  const [error, setError] = useState("");
  const [draft, setDraft] = useState(null);
  const [target, setTarget] = useState("__new__");

  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => setEmailText(String(ev.target.result || ""));
      reader.readAsText(file);
      return;
    }
    const text = e.dataTransfer.getData("text/plain");
    if (text) setEmailText(text);
  };

  const runExtract = async () => {
    if (!emailText.trim()) return;
    setStatus("extracting");
    setError("");
    try {
      const result = await extractFromEmail(emailText, team);
      const tasks = (result.tasks || []).map((t) => ({
        id: genId(),
        description: t.description || "",
        assignee: matchMemberByName(t.suggestedAssigneeName, team),
        suggestedName: t.suggestedAssigneeName || "",
        reason: t.reason || "",
        dueDate: t.dueDate || "",
        dueTime: t.dueTime || "",
        done: false,
      }));
      setDraft({
        name: result.opportunityName || "",
        client: result.client || "",
        dueDate: result.dueDate || "",
        tasks,
      });
      setStatus("review");
    } catch (e) {
      setError(e.message || "Couldn't read that email.");
      setStatus("error");
    }
  };

  const updateTask = (id, patch) => {
    setDraft((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  };
  const removeTask = (id) => {
    setDraft((d) => ({ ...d, tasks: d.tasks.filter((t) => t.id !== id) }));
  };
  const addBlankTask = () => {
    setDraft((d) => ({ ...d, tasks: [...d.tasks, { id: genId(), description: "", assignee: "", dueDate: "", dueTime: "", done: false }] }));
  };

  const confirm = () => {
    const cleanTasks = draft.tasks.filter((t) => t.description.trim());
    onConfirm({ target, draft: { ...draft, tasks: cleanTasks } });
  };

  return (
    <Modal title="Import from email" onClose={onClose} wide>
      {status === "input" && (
        <div>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            className="rounded-xl border-2 border-dashed flex flex-col items-center justify-center text-center px-4 py-6 mb-3 transition-colors"
            style={{ borderColor: dragActive ? COLORS.accent : COLORS.line, background: dragActive ? COLORS.accentSoft : COLORS.surfaceAlt }}
          >
            <Upload size={22} style={{ color: COLORS.inkSoft }} className="mb-2" />
            <p className="text-sm font-medium" style={{ color: COLORS.ink, fontFamily: FONT_BODY }}>Drop a .eml or .txt file here</p>
            <p className="text-xs mt-1" style={{ color: COLORS.inkFaint, fontFamily: FONT_BODY }}>
              Outlook's drag usually creates a .msg file browsers can't read — pasting the email text below is the most reliable path.
            </p>
          </div>
          <Field label="Or paste the email text">
            <textarea
              className="w-full rounded-lg px-3 py-2 text-sm min-h-[140px]"
              style={inputStyle}
              value={emailText}
              onChange={(e) => setEmailText(e.target.value)}
              placeholder="Paste the email body here — subject, from, and message all help."
            />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="accent" icon={Mail} disabled={!emailText.trim()} onClick={runExtract}>Extract tasks</Button>
          </div>
        </div>
      )}

      {status === "extracting" && (
        <div className="flex flex-col items-center justify-center py-10 gap-3">
          <Loader2 size={26} className="animate-spin" style={{ color: COLORS.primary }} />
          <p className="text-sm" style={{ color: COLORS.inkSoft, fontFamily: FONT_BODY }}>Reading the email and matching tasks to the team…</p>
        </div>
      )}

      {status === "error" && (
        <div>
          <div className="rounded-lg px-3 py-3 mb-3 text-sm" style={{ background: COLORS.dangerSoft, color: COLORS.danger, fontFamily: FONT_BODY }}>
            {error}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Close</Button>
            <Button variant="primary" onClick={() => setStatus("input")}>Try again</Button>
          </div>
        </div>
      )}

      {status === "review" && draft && (
        <div>
          <Field label="Add to">
            <select className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="__new__">➕ Create new opportunity</option>
              {opps.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>

          {target === "__new__" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
              <Field label="Name">
                <input className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </Field>
              <Field label="Client / GC">
                <input className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle} value={draft.client} onChange={(e) => setDraft({ ...draft, client: e.target.value })} />
              </Field>
              <Field label="Due date">
                <input type="date" className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle} value={draft.dueDate || ""} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} />
              </Field>
            </div>
          )}

          <div className="mt-1 mb-2 flex items-center justify-between">
            <span className="block text-xs font-semibold" style={{ color: COLORS.inkSoft, fontFamily: FONT_MONO, letterSpacing: "0.03em" }}>TASKS</span>
            <Button small variant="ghost" icon={Plus} onClick={addBlankTask}>Add task</Button>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {draft.tasks.length === 0 && <p className="text-xs" style={{ color: COLORS.inkFaint }}>No tasks yet — add one above.</p>}
            {draft.tasks.map((t) => (
              <div key={t.id} className="rounded-lg p-2.5" style={{ border: `1px solid ${COLORS.line}` }}>
                <div className="flex gap-2 items-start">
                  <input
                    className="flex-1 rounded-md px-2 py-1.5 text-sm" style={inputStyle}
                    value={t.description} placeholder="Task description"
                    onChange={(e) => updateTask(t.id, { description: e.target.value })}
                  />
                  <button onClick={() => removeTask(t.id)} className="p-1.5 rounded-md hover:opacity-60" style={{ color: COLORS.inkFaint }}><Trash2 size={14} /></button>
                </div>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <select className="rounded-md px-2 py-1 text-xs" style={inputStyle} value={t.assignee} onChange={(e) => updateTask(t.id, { assignee: e.target.value })}>
                    <option value="">Unassigned</option>
                    {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <input type="date" className="rounded-md px-2 py-1 text-xs" style={{ ...inputStyle, width: 130 }} value={t.dueDate || ""} onChange={(e) => updateTask(t.id, { dueDate: e.target.value })} />
                  <input type="time" className="rounded-md px-2 py-1 text-xs" style={{ ...inputStyle, width: 100 }} value={t.dueTime || ""} onChange={(e) => updateTask(t.id, { dueTime: e.target.value })} />
                  {t.suggestedName && (
                    <span className="text-xs" style={{ color: COLORS.inkFaint, fontFamily: FONT_BODY }}>
                      suggested: {t.suggestedName}{t.reason ? ` — ${t.reason}` : ""}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-3">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={target === "__new__" && !draft.name.trim()} onClick={confirm}>
              {target === "__new__" ? "Create opportunity" : "Add tasks"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ---------------------------------- Task row ---------------------------------- */

function TaskRow({ task, team, onToggle, onReassign, onDelete, onDueDateChange, onTimeChange, onCreateEvent }) {
  const assignee = team.find((m) => m.id === task.assignee);
  const overdue = isTaskOverdue(task);
  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg flex-wrap" style={{ background: task.done ? COLORS.successSoft : "transparent" }}>
      <button onClick={onToggle} className="shrink-0 w-4 h-4 rounded flex items-center justify-center" style={{ border: `1.5px solid ${task.done ? COLORS.success : COLORS.line}`, background: task.done ? COLORS.success : "transparent" }}>
        {task.done && <Check size={11} color="#fff" strokeWidth={3} />}
      </button>
      <span className="flex-1 min-w-[100px] text-sm" style={{ fontFamily: FONT_BODY, color: task.done ? COLORS.inkFaint : COLORS.ink, textDecoration: task.done ? "line-through" : "none" }}>
        {task.description}
      </span>
      {overdue && <AlertTriangle size={12} style={{ color: COLORS.danger }} className="shrink-0" />}
      <input
        type="date"
        className="text-xs rounded-md px-1.5 py-1 shrink-0"
        style={{ ...inputStyle, width: 118, color: overdue ? COLORS.danger : COLORS.ink }}
        value={task.dueDate || ""}
        onChange={(e) => onDueDateChange(e.target.value)}
      />
      <input
        type="time"
        className="text-xs rounded-md px-1.5 py-1 shrink-0"
        style={{ ...inputStyle, width: 96 }}
        value={task.dueTime || ""}
        onChange={(e) => onTimeChange(e.target.value)}
      />
      {task.dueDate && task.dueTime && (
        <button onClick={onCreateEvent} title="Add to calendar (.ics)" className="shrink-0 p-1 rounded hover:opacity-60" style={{ color: COLORS.primary }}>
          <Calendar size={13} />
        </button>
      )}
      <select
        className="text-xs rounded-md px-1.5 py-1 shrink-0"
        style={{ ...inputStyle, maxWidth: 110 }}
        value={task.assignee || ""}
        onChange={(e) => onReassign(e.target.value)}
      >
        <option value="">Unassigned</option>
        {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      <button onClick={onDelete} className="shrink-0 p-1 rounded hover:opacity-60" style={{ color: COLORS.inkFaint }}><Trash2 size={13} /></button>
    </div>
  );
}

/* ---------------------------------- Opportunity card ---------------------------------- */

function OppCard({ opp, num, team, expanded, onToggleExpand, onEdit, onDelete, onToggleTask, onReassignTask, onDeleteTask, onDueDateChange, onTimeChange, onAddTask, onApplyTemplates }) {
  const owner = team.find((m) => m.id === opp.owner);
  const helpers = opp.helpers.map((id) => team.find((m) => m.id === id)).filter(Boolean);
  const status = getStatus(opp);
  const total = opp.tasks.length;
  const done = opp.tasks.filter((t) => t.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const [newTask, setNewTask] = useState("");
  const [newTaskDate, setNewTaskDate] = useState("");

  const createEvent = (task) => {
    const [y, m, d] = task.dueDate.split("-").map(Number);
    const [h, min] = task.dueTime.split(":").map(Number);
    const start = new Date(y, m - 1, d, h, min);
    const title = eventTitle(opp.name, task.description, start);
    const ics = buildICS([{ title, start, durationMinutes: 60 }]);
    downloadICS(`${task.description.replace(/[^a-z0-9]+/gi, "-")}.ics`, ics);
  };

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: COLORS.surface, border: `1px solid ${COLORS.line}` }}>
      <div className="p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0">
            <span className="text-xs font-semibold pt-0.5 shrink-0" style={{ color: COLORS.accent, fontFamily: FONT_MONO }}>
              No.{String(num).padStart(2, "0")}
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold truncate" style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }}>{opp.name}</h3>
              {opp.client && <p className="text-xs truncate" style={{ color: COLORS.inkSoft, fontFamily: FONT_BODY }}>{opp.client}</p>}
            </div>
          </div>
          <StatusBadge status={status} />
        </div>

        <div className="flex items-center flex-wrap gap-x-4 gap-y-1.5 mt-2.5 text-xs" style={{ fontFamily: FONT_BODY, color: COLORS.inkSoft }}>
          <span className="flex items-center gap-1.5">Owner {owner ? <Avatar member={owner} size={20} /> : <span style={{ color: COLORS.inkFaint }}>—</span>} {owner?.name || "Unassigned"}</span>
          {helpers.length > 0 && (
            <span className="flex items-center gap-1">Helping
              <span className="flex -space-x-1 ml-1">{helpers.map((h) => <Avatar key={h.id} member={h} size={20} />)}</span>
            </span>
          )}
          <span>Due {fmtDate(opp.dueDate)}{opp.dueTime ? ` ${fmtTime(opp.dueTime)}` : ""}</span>
        </div>

        <div className="flex items-center gap-2 mt-2.5">
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: COLORS.surfaceAlt }}>
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: status === "overdue" ? COLORS.danger : COLORS.primary }} />
          </div>
          <span className="text-xs shrink-0" style={{ color: COLORS.inkFaint, fontFamily: FONT_MONO }}>{done}/{total}</span>
        </div>

        <div className="flex items-center justify-between mt-3">
          <button onClick={onToggleExpand} className="flex items-center gap-1 text-xs font-medium" style={{ color: COLORS.primary, fontFamily: FONT_BODY }}>
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {total} task{total !== 1 ? "s" : ""}
          </button>
          <div className="flex gap-1">
            <button onClick={onEdit} className="p-1.5 rounded-md hover:opacity-60" style={{ color: COLORS.inkFaint }}><Pencil size={13} /></button>
            <button onClick={onDelete} className="p-1.5 rounded-md hover:opacity-60" style={{ color: COLORS.inkFaint }}><Trash2 size={13} /></button>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="px-3.5 pb-3.5 pt-1" style={{ borderTop: `1px solid ${COLORS.line}` }}>
          <div className="flex items-center justify-between mt-2 mb-1">
            <span className="text-xs font-semibold" style={{ color: COLORS.inkSoft, fontFamily: FONT_MONO, letterSpacing: "0.03em" }}>TASKS</span>
            <Button small variant="ghost" icon={ListChecks} onClick={onApplyTemplates}>Add checklist</Button>
          </div>
          <div className="space-y-0.5">
            {opp.tasks.map((t) => (
              <TaskRow
                key={t.id} task={t} team={team}
                onToggle={() => onToggleTask(t.id)}
                onReassign={(v) => onReassignTask(t.id, v)}
                onDelete={() => onDeleteTask(t.id)}
                onDueDateChange={(v) => onDueDateChange(t.id, v)}
                onTimeChange={(v) => onTimeChange(t.id, v)}
                onCreateEvent={() => createEvent(t)}
              />
            ))}
          </div>
          <div className="flex gap-2 mt-2 flex-wrap">
            <input
              className="flex-1 min-w-[120px] rounded-md px-2 py-1.5 text-sm" style={inputStyle}
              placeholder="Add a task…" value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && newTask.trim()) { onAddTask(newTask.trim(), newTaskDate); setNewTask(""); setNewTaskDate(""); } }}
            />
            <input type="date" className="rounded-md px-2 py-1.5 text-xs" style={inputStyle} value={newTaskDate} onChange={(e) => setNewTaskDate(e.target.value)} />
            <Button small variant="ghost" icon={Plus} onClick={() => { if (newTask.trim()) { onAddTask(newTask.trim(), newTaskDate); setNewTask(""); setNewTaskDate(""); } }}>Add</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------- Workload tab ---------------------------------- */

function loadLevel(count) {
  if (count >= 6) return { color: COLORS.danger, bg: COLORS.dangerSoft, label: "Heavy" };
  if (count >= 3) return { color: COLORS.accent, bg: COLORS.accentSoft, label: "Moderate" };
  return { color: COLORS.success, bg: COLORS.successSoft, label: "Light" };
}

function WorkloadTab({ team, opps }) {
  if (team.length === 0) {
    return <EmptyState icon={Users} title="No team members yet" body="Add your team on the Team tab to see workload here." />;
  }
  const rows = team.map((m) => {
    const openTasks = opps.flatMap((o) => o.tasks.filter((t) => t.assignee === m.id && !t.done));
    const ownedOpen = opps.filter((o) => o.owner === m.id && getStatus(o) !== "complete");
    const helpingOpen = opps.filter((o) => o.helpers.includes(m.id) && getStatus(o) !== "complete");
    const overdueTasks = openTasks.filter((t) => {
      const opp = opps.find((o) => o.tasks.some((x) => x.id === t.id));
      return opp && getStatus(opp) === "overdue";
    });
    return { member: m, openTasks, ownedOpen, helpingOpen, overdueCount: overdueTasks.length };
  }).sort((a, b) => b.openTasks.length - a.openTasks.length);

  return (
    <div className="space-y-3">
      <p className="text-xs" style={{ color: COLORS.inkFaint, fontFamily: FONT_BODY }}>
        Load is a rough count of open tasks per person — 0–2 light, 3–5 moderate, 6+ heavy. Use it as a signal, not a formula.
      </p>
      {rows.map(({ member, openTasks, ownedOpen, helpingOpen, overdueCount }) => {
        const level = loadLevel(openTasks.length);
        return (
          <div key={member.id} className="rounded-xl p-3.5" style={{ background: COLORS.surface, border: `1px solid ${COLORS.line}` }}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <Avatar member={member} size={32} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }}>{member.name}</p>
                  {member.specialty && <p className="text-xs truncate" style={{ color: COLORS.inkSoft, fontFamily: FONT_BODY }}>{member.specialty}</p>}
                </div>
              </div>
              <span className="text-xs font-semibold px-2 py-1 rounded-full shrink-0" style={{ background: level.bg, color: level.color, fontFamily: FONT_BODY }}>{level.label}</span>
            </div>

            <div className="flex items-center gap-1 mt-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <span key={i} className="h-4 flex-1 rounded-sm" style={{ background: i < Math.min(openTasks.length, 8) ? level.color : COLORS.surfaceAlt }} />
              ))}
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5 text-xs" style={{ color: COLORS.inkSoft, fontFamily: FONT_MONO }}>
              <span>{openTasks.length} open task{openTasks.length !== 1 ? "s" : ""}</span>
              <span>{ownedOpen.length} owned</span>
              <span>{helpingOpen.length} helping</span>
              {overdueCount > 0 && <span style={{ color: COLORS.danger }}>{overdueCount} overdue</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------- Team tab ---------------------------------- */

function TeamTab({ team, onAdd, onUpdate, onDelete, onBulkAdd, onClearAll }) {
  const [name, setName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const clearTimer = useRef(null);

  const submit = () => {
    if (!name.trim()) return;
    onAdd({ id: genId(), name: name.trim(), specialty: specialty.trim() });
    setName(""); setSpecialty("");
  };

  const submitBulk = () => {
    const rows = bulkText.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
      const [n, s] = line.split(/[-–—:]/).map((x) => x?.trim());
      return { id: genId(), name: n || line, specialty: s || "" };
    });
    if (rows.length) onBulkAdd(rows);
    setBulkText(""); setBulkOpen(false);
  };

  const handleClear = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      clearTimer.current = setTimeout(() => setConfirmClear(false), 3000);
      return;
    }
    clearTimeout(clearTimer.current);
    setConfirmClear(false);
    onClearAll();
  };

  return (
    <div>
      <div className="rounded-xl p-3.5 mb-4" style={{ background: COLORS.surface, border: `1px solid ${COLORS.line}` }}>
        <div className="flex flex-col sm:flex-row gap-2">
          <input className="flex-1 rounded-lg px-3 py-2 text-sm" style={inputStyle} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="flex-1 rounded-lg px-3 py-2 text-sm" style={inputStyle} placeholder="Specialty (e.g. Lighting, Panels, Fire Alarm)" value={specialty} onChange={(e) => setSpecialty(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
          <Button icon={Plus} onClick={submit} disabled={!name.trim()}>Add</Button>
        </div>
        <button onClick={() => setBulkOpen((v) => !v)} className="text-xs font-medium mt-2" style={{ color: COLORS.primary, fontFamily: FONT_BODY }}>
          {bulkOpen ? "Hide bulk add" : "Bulk add (paste a list)"}
        </button>
        {bulkOpen && (
          <div className="mt-2">
            <textarea
              className="w-full rounded-lg px-3 py-2 text-sm min-h-[100px]" style={inputStyle}
              placeholder={"One person per line, e.g.\nJordan Diaz - Lighting\nKim Park - Fire Alarm"}
              value={bulkText} onChange={(e) => setBulkText(e.target.value)}
            />
            <div className="flex justify-end mt-2">
              <Button small onClick={submitBulk} disabled={!bulkText.trim()}>Add all</Button>
            </div>
          </div>
        )}
      </div>

      {team.length === 0 ? (
        <EmptyState icon={Users} title="No team members yet" body="Add your 10 estimators above — name and specialty. Specialty is what task suggestions match against." />
      ) : (
        <div className="space-y-1.5">
          {team.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-lg px-3 py-2.5" style={{ background: COLORS.surface, border: `1px solid ${COLORS.line}` }}>
              <Avatar member={m} size={30} />
              <input
                className="flex-1 min-w-0 text-sm font-medium bg-transparent outline-none" style={{ fontFamily: FONT_BODY, color: COLORS.ink }}
                value={m.name} onChange={(e) => onUpdate(m.id, { name: e.target.value })}
              />
              <input
                className="flex-1 min-w-0 text-sm bg-transparent outline-none text-right" style={{ fontFamily: FONT_BODY, color: COLORS.inkSoft }}
                value={m.specialty} placeholder="specialty" onChange={(e) => onUpdate(m.id, { specialty: e.target.value })}
              />
              <button onClick={() => onDelete(m.id)} className="shrink-0 p-1 rounded hover:opacity-60" style={{ color: COLORS.inkFaint }}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 pt-4" style={{ borderTop: `1px solid ${COLORS.line}` }}>
        <button onClick={handleClear} className="text-xs" style={{ color: confirmClear ? COLORS.danger : COLORS.inkFaint, fontFamily: FONT_BODY }}>
          {confirmClear ? "Click again to clear all data — this affects everyone on the shared board" : "Clear all data"}
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------- Empty state ---------------------------------- */

function EmptyState({ icon: Icon, title, body, action }) {
  return (
    <div className="flex flex-col items-center text-center py-14 px-4 rounded-xl" style={{ background: COLORS.surfaceAlt, border: `1px dashed ${COLORS.line}` }}>
      <Icon size={26} style={{ color: COLORS.inkFaint }} className="mb-3" />
      <p className="text-sm font-semibold" style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }}>{title}</p>
      <p className="text-xs mt-1 max-w-xs" style={{ color: COLORS.inkFaint, fontFamily: FONT_BODY }}>{body}</p>
      {action}
    </div>
  );
}

/* ---------------------------------- Checklist templates tab ---------------------------------- */

function TemplatesTab({ templates, onUpdate }) {
  const updateItem = (id, patch) => onUpdate(templates.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const removeItem = (id) => onUpdate(templates.filter((t) => t.id !== id));
  const addItem = () => onUpdate([...templates, { id: genId(), description: "", mode: "offset", offsetValue: 1, offsetUnit: "days", anchor: "before" }]);

  return (
    <div>
      <p className="text-xs mb-3" style={{ color: COLORS.inkFaint, fontFamily: FONT_BODY }}>
        This checklist is offered automatically when you create a new opportunity, and can be applied anytime from an opportunity's card. "Calculated" tasks are figured from the opportunity's bid due date — hour-based ones also need a bid due time. "Filled in manually" tasks (like a job walk) are added with a blank date for you to set once you know it.
      </p>
      <div className="space-y-2">
        {templates.length === 0 && <p className="text-xs" style={{ color: COLORS.inkFaint }}>No checklist tasks yet — add one below.</p>}
        {templates.map((tpl) => (
          <div key={tpl.id} className="rounded-lg p-2.5 flex flex-col gap-2" style={{ background: COLORS.surface, border: `1px solid ${COLORS.line}` }}>
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-md px-2 py-1.5 text-sm" style={inputStyle}
                value={tpl.description} placeholder="Task description"
                onChange={(e) => updateItem(tpl.id, { description: e.target.value })}
              />
              <button onClick={() => removeItem(tpl.id)} className="p-1.5 rounded-md hover:opacity-60" style={{ color: COLORS.inkFaint }}><Trash2 size={14} /></button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <select className="rounded-md px-2 py-1 text-xs" style={inputStyle} value={tpl.mode} onChange={(e) => updateItem(tpl.id, { mode: e.target.value })}>
                <option value="offset">Calculated from bid due date</option>
                <option value="manual">Filled in manually</option>
              </select>
              {tpl.mode === "offset" && (
                <>
                  <input
                    type="number" min="0" className="rounded-md px-2 py-1 text-xs" style={{ ...inputStyle, width: 60 }}
                    value={tpl.offsetValue} onChange={(e) => updateItem(tpl.id, { offsetValue: Number(e.target.value) })}
                  />
                  <select className="rounded-md px-2 py-1 text-xs" style={inputStyle} value={tpl.offsetUnit} onChange={(e) => updateItem(tpl.id, { offsetUnit: e.target.value })}>
                    <option value="hours">hours</option>
                    <option value="days">days</option>
                    <option value="weeks">weeks</option>
                  </select>
                  <select className="rounded-md px-2 py-1 text-xs" style={inputStyle} value={tpl.anchor} onChange={(e) => updateItem(tpl.id, { anchor: e.target.value })}>
                    <option value="before">before bid due date</option>
                    <option value="after">after bid due date</option>
                  </select>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3">
        <Button small variant="ghost" icon={Plus} onClick={addItem}>Add task</Button>
      </div>
    </div>
  );
}

/* ---------------------------------- Root ---------------------------------- */

export default function WorkloadTracker() {
  const [loading, setLoading] = useState(true);
  const [team, setTeam] = useState([]);
  const [opps, setOpps] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [tab, setTab] = useState("board");
  const [importOpen, setImportOpen] = useState(false);
  const [oppModal, setOppModal] = useState(null); // null | 'new' | opp object
  const [expandedId, setExpandedId] = useState(null);
  const [filterMember, setFilterMember] = useState("all");
  const [search, setSearch] = useState("");
  const [saveNote, setSaveNote] = useState(null); // { msg, type } | null

  useEffect(() => {
    (async () => {
      const { team: t, opps: o, templates: tpl } = await loadState();
      setTeam(t); setOpps(o);
      if (tpl === null) {
        setTemplates(DEFAULT_TEMPLATES);
        try { await persist("task-templates", DEFAULT_TEMPLATES); } catch (e) { /* ignore — will retry on next save */ }
      } else {
        setTemplates(tpl);
      }
      setLoading(false);
    })();
  }, []);

  const flash = (msg, type = "info") => { setSaveNote({ msg, type }); setTimeout(() => setSaveNote(null), 3000); };

  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    const { team: t, opps: o, templates: tpl } = await loadState();
    setTeam(t); setOpps(o);
    setTemplates(tpl === null ? DEFAULT_TEMPLATES : tpl);
    setRefreshing(false);
  };

  const updateTeam = useCallback(async (next) => {
    setTeam(next);
    try { await persist("team-members", next); } catch (e) { flash("Couldn't save — changes may not persist.", "error"); }
  }, []);
  const updateOpps = useCallback(async (next) => {
    setOpps(next);
    try { await persist("opportunities", next); } catch (e) { flash("Couldn't save — changes may not persist.", "error"); }
  }, []);
  const updateTemplates = useCallback(async (next) => {
    setTemplates(next);
    try { await persist("task-templates", next); } catch (e) { flash("Couldn't save — checklist changes may not persist.", "error"); }
  }, []);

  /* ---- opportunity handlers ---- */
  const saveOpp = (fields) => {
    const { applyTemplates: shouldApply, ...oppFields } = fields;
    if (oppModal && oppModal !== "new") {
      updateOpps(opps.map((o) => (o.id === oppModal.id ? { ...o, ...oppFields } : o)));
    } else {
      const nextNum = opps.reduce((max, o) => Math.max(max, o.num || 0), 0) + 1;
      const newOpp = { id: genId(), num: nextNum, tasks: [], ...oppFields };
      if (shouldApply) newOpp.tasks = buildTemplateTasks(newOpp, templates);
      updateOpps([...opps, newOpp]);
    }
    setOppModal(null);
  };
  const deleteOpp = (id) => updateOpps(opps.filter((o) => o.id !== id));

  const toggleTask = (oppId, taskId) => updateOpps(opps.map((o) => o.id !== oppId ? o : { ...o, tasks: o.tasks.map((t) => t.id === taskId ? { ...t, done: !t.done } : t) }));
  const reassignTask = (oppId, taskId, assignee) => updateOpps(opps.map((o) => o.id !== oppId ? o : { ...o, tasks: o.tasks.map((t) => t.id === taskId ? { ...t, assignee } : t) }));
  const deleteTask = (oppId, taskId) => updateOpps(opps.map((o) => o.id !== oppId ? o : { ...o, tasks: o.tasks.filter((t) => t.id !== taskId) }));
  const changeTaskDueDate = (oppId, taskId, dueDate) => updateOpps(opps.map((o) => o.id !== oppId ? o : { ...o, tasks: o.tasks.map((t) => t.id === taskId ? { ...t, dueDate } : t) }));
  const changeTaskTime = (oppId, taskId, dueTime) => updateOpps(opps.map((o) => o.id !== oppId ? o : { ...o, tasks: o.tasks.map((t) => t.id === taskId ? { ...t, dueTime } : t) }));
  const addTask = (oppId, description, dueDate) => updateOpps(opps.map((o) => o.id !== oppId ? o : { ...o, tasks: [...o.tasks, { id: genId(), description, assignee: "", dueDate: dueDate || "", dueTime: "", done: false }] }));

  const applyTemplatesToOpp = (oppId) => {
    const opp = opps.find((o) => o.id === oppId);
    if (!opp) return;
    const existing = new Set(opp.tasks.map((t) => t.description.trim().toLowerCase()));
    const additions = buildTemplateTasks(opp, templates).filter((t) => !existing.has(t.description.trim().toLowerCase()));
    if (additions.length === 0) { flash("All checklist tasks are already on this opportunity."); return; }
    const anyImprecise = templates.some((tpl) => tpl.mode === "offset" && tpl.offsetUnit === "hours" && !opp.dueTime);
    updateOpps(opps.map((o) => (o.id === oppId ? { ...o, tasks: [...o.tasks, ...additions] } : o)));
    flash(anyImprecise ? `Added ${additions.length} task(s) — set a due time on this opportunity for precise hour-based deadlines.` : `Added ${additions.length} task(s).`);
  };

  /* ---- import confirm ---- */
  const confirmImport = ({ target, draft }) => {
    if (target === "__new__") {
      const nextNum = opps.reduce((max, o) => Math.max(max, o.num || 0), 0) + 1;
      updateOpps([...opps, { id: genId(), num: nextNum, name: draft.name, client: draft.client, owner: "", helpers: [], dueDate: draft.dueDate, tasks: draft.tasks }]);
    } else {
      updateOpps(opps.map((o) => o.id === target ? { ...o, tasks: [...o.tasks, ...draft.tasks] } : o));
    }
    setImportOpen(false);
  };

  /* ---- team handlers ---- */
  const addMember = (m) => updateTeam([...team, m]);
  const bulkAddMembers = (rows) => updateTeam([...team, ...rows]);
  const updateMember = (id, patch) => updateTeam(team.map((m) => m.id === id ? { ...m, ...patch } : m));
  const deleteMember = (id) => updateTeam(team.filter((m) => m.id !== id));
  const clearAll = () => { updateTeam([]); updateOpps([]); };

  const filteredOpps = opps
    .filter((o) => filterMember === "all" || o.owner === filterMember || o.helpers.includes(filterMember))
    .filter((o) => !search.trim() || (o.name + " " + (o.client || "")).toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return a.num - b.num;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={22} className="animate-spin" style={{ color: COLORS.primary }} />
      </div>
    );
  }

  const TABS = [
    { id: "board", label: "Board", icon: LayoutGrid },
    { id: "workload", label: "Workload", icon: Gauge },
    { id: "checklist", label: "Checklist", icon: ListChecks },
    { id: "team", label: "Team", icon: Users },
  ];

  return (
    <div className="w-full min-h-[600px]" style={{ background: COLORS.bg, fontFamily: FONT_BODY }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');`}</style>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div>
            <h1 className="text-lg font-bold" style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }}>Opportunity Board</h1>
            <p className="text-xs" style={{ color: COLORS.inkFaint, fontFamily: FONT_MONO }}>{opps.length} open · {team.length} on the team</p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" icon={RotateCw} small onClick={refresh} disabled={refreshing}>Refresh</Button>
            <Button variant="ghost" icon={Plus} small onClick={() => setOppModal("new")}>New opportunity</Button>
            <Button variant="accent" icon={Mail} small onClick={() => setImportOpen(true)}>From email</Button>
          </div>
        </div>

        <div className="flex gap-1 mb-4 p-1 rounded-xl w-fit" style={{ background: COLORS.surfaceAlt }}>
          {TABS.map((t) => (
            <button
              key={t.id} onClick={() => setTab(t.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={tab === t.id ? { background: COLORS.surface, color: COLORS.primary, boxShadow: "0 1px 2px rgba(0,0,0,0.06)" } : { color: COLORS.inkSoft }}
            >
              <t.icon size={14} /> {t.label}
            </button>
          ))}
        </div>

        {saveNote && (
          <div
            className="text-xs rounded-lg px-3 py-2 mb-3"
            style={saveNote.type === "error" ? { background: COLORS.dangerSoft, color: COLORS.danger } : { background: COLORS.primarySoft, color: COLORS.primary }}
          >
            {saveNote.msg}
          </div>
        )}

        {tab === "board" && (
          <div>
            <div className="flex flex-col sm:flex-row gap-2 mb-3">
              <div className="flex items-center flex-1 rounded-lg px-2.5" style={{ ...inputStyle }}>
                <Search size={14} style={{ color: COLORS.inkFaint }} />
                <input className="flex-1 px-2 py-2 text-sm bg-transparent outline-none" placeholder="Search opportunities…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <select className="rounded-lg px-3 py-2 text-sm" style={{ ...inputStyle, maxWidth: 200 }} value={filterMember} onChange={(e) => setFilterMember(e.target.value)}>
                <option value="all">Everyone</option>
                {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>

            {opps.length === 0 ? (
              <EmptyState
                icon={LayoutGrid} title="No opportunities yet"
                body="Add one manually, or drop in an email and let it pull out the tasks."
              />
            ) : filteredOpps.length === 0 ? (
              <EmptyState icon={Search} title="Nothing matches" body="Try a different search or filter." />
            ) : (
              <div className="space-y-2.5">
                {filteredOpps.map((o) => (
                  <OppCard
                    key={o.id} opp={o} num={o.num} team={team}
                    expanded={expandedId === o.id}
                    onToggleExpand={() => setExpandedId(expandedId === o.id ? null : o.id)}
                    onEdit={() => setOppModal(o)}
                    onDelete={() => deleteOpp(o.id)}
                    onToggleTask={(tid) => toggleTask(o.id, tid)}
                    onReassignTask={(tid, a) => reassignTask(o.id, tid, a)}
                    onDeleteTask={(tid) => deleteTask(o.id, tid)}
                    onDueDateChange={(tid, v) => changeTaskDueDate(o.id, tid, v)}
                    onTimeChange={(tid, v) => changeTaskTime(o.id, tid, v)}
                    onAddTask={(desc, due) => addTask(o.id, desc, due)}
                    onApplyTemplates={() => applyTemplatesToOpp(o.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "workload" && <WorkloadTab team={team} opps={opps} />}
        {tab === "checklist" && <TemplatesTab templates={templates} onUpdate={updateTemplates} />}
        {tab === "team" && (
          <TeamTab team={team} onAdd={addMember} onUpdate={updateMember} onDelete={deleteMember} onBulkAdd={bulkAddMembers} onClearAll={clearAll} />
        )}
      </div>

      {oppModal && (
        <OppFormModal
          team={team}
          existing={oppModal === "new" ? null : oppModal}
          onSave={saveOpp}
          onClose={() => setOppModal(null)}
        />
      )}
      {importOpen && (
        <ImportModal team={team} opps={opps} onClose={() => setImportOpen(false)} onConfirm={confirmImport} />
      )}
    </div>
  );
}
