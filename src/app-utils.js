function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function todayKey() {
  return new Date().toLocaleDateString("sv-SE");
}

function dateLabel(date) {
  if (date === todayKey()) return "今天";
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function timestampMs(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function avg(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[char],
  );
}

function icon(name) {
  const paths = {
    home: `<path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/>`,
    fork: `<path d="M6 3v8M10 3v8M6 7h4M8 11v10M17 3v18M17 3c3 2 4 6 0 9"/>`,
    dumbbell: `<path d="M4 9v6M8 7v10M16 7v10M20 9v6M8 12h8"/>`,
    chart: `<path d="M4 19V5M4 19h17M8 15l3-4 3 2 5-7"/>`,
    user: `<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0"/>`,
    bell: `<path d="M18 9a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>`,
    camera: `<path d="M4 7h3l2-3h6l2 3h3v13H4z"/><circle cx="12" cy="13" r="4"/>`,
    signal: `<path d="M4 18h2M9 18h2v-5H9zM14 18h2V9h-2zM19 18h2V5h-2z"/>`,
    wifi: `<path d="M5 10a11 11 0 0 1 14 0M8 14a6 6 0 0 1 8 0M12 18h.01"/>`,
    battery: `<path d="M4 8h15v8H4zM21 11v2M7 11h8v2H7z"/>`,
    water: `<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11Z"/>`,
    steps: `<path d="M7 21c-2 0-3-1-3-3 0-3 3-5 5-3 2 3 1 6-2 6ZM17 12c-2 0-3-1-3-3 0-3 3-5 5-3 2 3 1 6-2 6Z"/>`,
    moon: `<path d="M20 15.5A8 8 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z"/>`,
    heart: `<path d="M20.8 5.8a5.2 5.2 0 0 0-7.4 0L12 7.2l-1.4-1.4a5.2 5.2 0 0 0-7.4 7.4L12 22l8.8-8.8a5.2 5.2 0 0 0 0-7.4Z"/>`,
    leaf: `<path d="M4 20c7 0 13-6 16-16C10 6 4 12 4 20Z"/><path d="M4 20c4-5 8-8 14-11"/>`,
    sun: `<path d="M12 5V3M12 21v-2M5 12H3M21 12h-2M6.3 6.3 4.9 4.9M19.1 19.1l-1.4-1.4M17.7 6.3l1.4-1.4M4.9 19.1l1.4-1.4"/><circle cx="12" cy="12" r="4"/>`,
    edit: `<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>`,
    plus: `<path d="M12 5v14M5 12h14"/>`,
    minus: `<path d="M5 12h14"/>`,
    spark: `<path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z"/>`,
    timer: `<path d="M10 2h4M12 8v5l3 2M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z"/>`,
    flame: `<path d="M12 22c4 0 7-3 7-7 0-5-5-7-5-12-5 3-9 8-9 12 0 4 3 7 7 7Z"/>`,
    level: `<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>`,
    check: `<path d="m5 12 4 4L19 6"/>`,
    close: `<path d="M6 6l12 12M18 6 6 18"/>`,
    arrow: `<path d="M9 18l6-6-6-6"/>`,
    refresh: `<path d="M20 11a8 8 0 0 0-14.5-4M4 7V3h4M4 13a8 8 0 0 0 14.5 4M20 17v4h-4"/>`,
    download: `<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>`,
    settings: `<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-5l-.3 3a7 7 0 0 0-1.7 1l-2.4-1-2 3.5L5.1 11a7 7 0 0 0 0 2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 1.7 1l.3 3h5l.3-3a7 7 0 0 0 1.7-1l2.4 1 2-3.5-2-1.5c.1-.3.1-.7.1-1Z"/>`,
    medal: `<path d="M8 3h8l-2 5h-4zM12 21a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z"/><path d="m10.5 15 1 1 2-2"/>`,
    lock: `<path d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v10H6z"/>`,
    trash: `<path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"/>`,
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.home}</svg>`;
}

function currentTimeLabel() {
  return new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function motionPreference() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

export {
  cloneData,
  isPlainRecord,
  finiteNumber,
  todayKey,
  dateLabel,
  timestampMs,
  avg,
  escapeHtml,
  icon,
  currentTimeLabel,
  motionPreference,
};
