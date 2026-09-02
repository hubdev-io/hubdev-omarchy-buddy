.pragma library

// State colour only. Pure, QML-free, testable.
//
// Plan §5.3.1: state colour is HARD-CODED — a failure must look like a failure
// in every Omarchy theme, and a theme is free to make its foreground amber,
// which is exactly the warning hue. Everything that is not state (chrome,
// text, separators, the mark) inherits `qs.Ui.Style` and the bar foreground,
// and none of it is defined here.
//
// This machine's own theme (#F99957 amber on #060B1E navy) is the adversarial
// case: an amber foreground sits next to `warn`, so warning MUST also be
// distinguishable by glyph. Hence `glyphFor` — colour never carries state alone.

var COLOR = {
  ok: "#10B981",     // emerald
  warn: "#F59E0B",   // amber
  down: "#EF4444",   // red
  info: "#0EA5E9",   // sky
  idle: "#6B7280"    // grey
};

// Nerd Font glyphs. The pair (colour, glyph) carries state so that neither a
// theme clash nor a monochrome screenshot can lose it.
var GLYPH = {
  ok: "",      // circle-check
  warn: "",    // triangle-exclamation
  down: "",    // circle-xmark
  idle: ""     // circle-question
};

function colorFor(level) {
  return COLOR[level] || COLOR.idle;
}

function glyphFor(level) {
  return GLYPH[level] || GLYPH.idle;
}

// The dot is drawn ONLY when something is wrong (plan §5.1). Healthy is quiet:
// a monochrome mark taking the bar foreground and nothing else.
function dotVisible(level) {
  return level === "warn" || level === "down";
}

// ---------------------------------------------------------------- icons ----
//
// Nerd Font glyphs for the panel's own chrome. Every codepoint here is one
// lerd Glance already ships against Omarchy, so they are known to resolve in
// the shell's font rather than guessed from a cheatsheet — a missing glyph
// renders as a tofu box, which is the kind of thing that only shows up on
// someone else's machine.
//
// These are decoration, not state. State is carried by COLOR + GLYPH above,
// which is the pair the plan requires (§5.3.1).
var ICONS = {
  "view-dense": "\u{F0569}",     // nf-md-table_large
  "view-columns": "\u{F0571}",   // nf-md-view_column
  "external-link": "",
  "refresh": "",
  "caret-down": "",
  "caret-right": "",
  "spinner": "",
  "lock": "",
  // Site row actions. Font Awesome range, same as everything above it — these
  // three were checked against this machine's JetBrainsMono Nerd Font cmap
  // rather than a cheatsheet, because a missing glyph is a tofu box that only
  // shows up on someone else's screen.
  "terminal": "",   // nf-fa-terminal
  "folder": "",     // nf-fa-folder_open
  "code": "",       // nf-fa-code
  // Type-to-filter. Same range, checked the same way.
  "search": "",     // nf-fa-search
  // Service row actions. Font Awesome again, and again verified against this
  // machine's JetBrainsMono Nerd Font cmap rather than a cheatsheet.
  //
  // `restart` is deliberately the same codepoint as `refresh`: it is the same
  // gesture, said about a service instead of about the panel, and inventing a
  // second circular arrow so the two could differ would only make the row
  // harder to read.
  "play": "",       // nf-fa-play
  "stop": "",       // nf-fa-stop
  "restart": "",    // nf-fa-refresh
  // The armed half of a confirm gate. A check, not a warning triangle: the
  // question has already been asked in words at the foot of the panel, and
  // what this button now does is answer it.
  "confirm": ""     // nf-fa-check
};

function icon(name) {
  return ICONS[name] || "";
}

// Site drivers. HubDev reports `laravel` for a Laravel app and `generic` for
// anything it could not identify; unknown values fall through to the generic
// glyph rather than to empty, so a driver added upstream still draws a row.
var DRIVER_GLYPHS = {
  laravel: "",     // bolt
  wordpress: "",
  generic: ""      // file
};

function driverGlyph(driver) {
  return DRIVER_GLYPHS[driver] || DRIVER_GLYPHS.generic;
}

// The service dot: running is ok, a service that should be running and is not
// is down, and anything else is simply idle. Deliberately NOT `warn` — the
// panel already names broken services in "Needs attention", and painting six
// stopped-on-purpose services amber would make the section unreadable.
function serviceLevel(row) {
  if (row.up)
    return "ok";
  return row.broken ? "down" : "idle";
}

// A site is ok when it is serving, down when the user meant it to serve and it
// does not, and idle when it is parked. `active` is the intent; `serving` is
// whether the machine agrees — which is a stricter question than `routePresent`
// alone, because with Caddy stopped there is no route table and every site is
// unreachable regardless of what it is linked to. Model.summarize owns that
// rule; this only paints it.
function siteLevel(row) {
  if (!row.active)
    return "idle";
  return row.serving ? "ok" : "down";
}
