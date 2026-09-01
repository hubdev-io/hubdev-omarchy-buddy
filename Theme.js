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
