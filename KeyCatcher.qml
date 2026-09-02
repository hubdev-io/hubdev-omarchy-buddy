import QtQuick

// The panel's keys. A local replacement for `qs.Ui`'s PanelKeyCatcher, and the
// only file in this plugin that duplicates something the shell already ships.
//
// The reason is specific and not a matter of taste. PanelKeyCatcher spends the
// unmodified letters on vim navigation — `h`, `j`, `k`, `l` move a cursor and
// `x` deletes — and only forwards what is left to `textKey`. That is exactly
// right for a panel with a row cursor, and it makes type-to-filter impossible:
// four of the letters in `hubdev.test` never arrive, and the two shortcuts this
// panel already had (`v`, `r`) would swallow the first keystroke of any search
// for a site whose name starts with one. There is no configuration of the
// shared component that yields both, so this panel keeps its own.
//
// What it keeps from the original: Keys.BeforeItem priority (so nothing nested
// eats a key first), Escape, Tab, `moveRequested`, and `blocked` for a future
// inline editor. What it drops is only the *letter* bindings — the cursor is
// driven by the arrow keys alone, which is the one thing the shared component
// could not give a panel that also filters as you type.
//
// It decides nothing. A key becomes a signal; what a signal means is Panel.qml's
// business — including whether Escape clears the query or closes the panel.
Item {
  id: root

  // True forwards every key to descendants untouched. Nothing sets it today;
  // it is the seam a real text input would need.
  property bool blocked: false

  signal closeRequested()
  signal tabRequested(int direction)

  // Arrows only. Same signature as the shared component's, so a panel written
  // against one reads the same against the other.
  signal moveRequested(int dx, int dy)

  // Space. "Press the thing the cursor is on", and nothing else — a Space with
  // no cursor is ignored rather than guessed at, because it is also a key
  // somebody types by accident in the middle of a query.
  signal activateRequested()

  // Return. Separate from Space precisely because it is allowed a fallback:
  // with no cursor it opens the top search match. That is a decision the panel
  // makes; this file only says which key was pressed.
  signal returnRequested()

  // One printable character, typed with no modifier held.
  signal textEntered(string text)
  // Backspace. `all` is Ctrl+Backspace / Ctrl+U / Ctrl+W — erase the lot.
  signal eraseRequested(bool all)
  // A letter with Ctrl or Alt held. The panel's shortcuts live here now, off
  // the bare letters, because the bare letters belong to the search.
  signal commandKey(string letter)

  focus: true
  Keys.priority: Keys.BeforeItem
  Keys.onPressed: function (event) {
    if (root.blocked)
      return;

    var mod = event.modifiers & (Qt.ControlModifier | Qt.AltModifier | Qt.MetaModifier);

    if (event.key === Qt.Key_Escape) {
      root.closeRequested();
      event.accepted = true;
      return;
    }

    if (event.key === Qt.Key_Tab || event.key === Qt.Key_Backtab) {
      root.tabRequested((event.modifiers & Qt.ShiftModifier) || event.key === Qt.Key_Backtab ? -1 : 1);
      event.accepted = true;
      return;
    }

    if (event.key === Qt.Key_Down) {
      root.moveRequested(0, 1);
      event.accepted = true;
      return;
    }

    if (event.key === Qt.Key_Up) {
      root.moveRequested(0, -1);
      event.accepted = true;
      return;
    }

    if (event.key === Qt.Key_Right) {
      root.moveRequested(1, 0);
      event.accepted = true;
      return;
    }

    if (event.key === Qt.Key_Left) {
      root.moveRequested(-1, 0);
      event.accepted = true;
      return;
    }

    if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
      root.returnRequested();
      event.accepted = true;
      return;
    }

    // Before the printable branch, or it would be typed into the query. It
    // never belonged there anyway: the matcher folds whitespace out, so a
    // space has never been able to change what a search finds.
    if (event.key === Qt.Key_Space) {
      root.activateRequested();
      event.accepted = true;
      return;
    }

    if (event.key === Qt.Key_Backspace) {
      root.eraseRequested((event.modifiers & Qt.ControlModifier) !== 0);
      event.accepted = true;
      return;
    }

    // Ctrl+U and Ctrl+W: the two "clear the line" reflexes a terminal user
    // already has. Handled before the generic command key so they cannot be
    // claimed by a shortcut later.
    if ((event.modifiers & Qt.ControlModifier) && (event.key === Qt.Key_U || event.key === Qt.Key_W)) {
      root.eraseRequested(true);
      event.accepted = true;
      return;
    }

    if (mod && event.key >= Qt.Key_A && event.key <= Qt.Key_Z) {
      root.commandKey(String.fromCharCode(event.key).toLowerCase());
      event.accepted = true;
      return;
    }

    // Anything printable, and only when no modifier is held — Shift excepted,
    // since that is how capitals and `.` on some layouts are typed. The 0x20
    // floor drops the control characters Qt reports as one-character text.
    if (!mod && event.text.length === 1 && event.text.charCodeAt(0) >= 0x20 && event.text.charCodeAt(0) !== 0x7f) {
      root.textEntered(event.text);
      event.accepted = true;
    }
  }
}
