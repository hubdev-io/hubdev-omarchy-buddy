import QtQuick
import qs.Commons

// The machine itself: Caddy, each PHP, Docker, Node, DNS, hosts, and the
// doctor's roll-up. This is what stands in for lerd Glance's Resources column
// (plan §5.2) — HubDev has no CPU figure, and its memory figure costs a Docker
// stats sample per service, so a 30-second poll is the wrong place for it.
//
// Two of these rows can be started and stopped, and the section decides neither
// which nor when: `Model.envRows` stamps a target on the ones that can,
// `Actions.envArgv` decides which verb applies right now, and this file
// arranges rows.
//
// Under a live query it narrows to the toggleable rows that matched, rather
// than hiding as it used to. That was right while every row here was a reading
// — a filter is for reaching the thing you want to press, and there was nothing
// to press. Caddy and PHP changed that, and `Model.visibleEnv` is where the
// narrowing happens, in the same place and the same shape as for the two lists.
Section {
  id: root

  property var summary: ({})
  // Model.visibleEnv(summary, search) — from the panel, which owns the query,
  // and which builds the keyboard map from this same list.
  property var list: ({ rows: [], searching: false, total: 0 })
  property var actionState: ({ phase: "idle", subject: "", key: "" })
  property string confirmKey: ""
  property string cursorKey: ""
  property int cursorCol: 0

  signal envActionRequested(var row, string key)
  signal cursorRequested(string key, int col)
  signal revealRequested(var item)

  title: "Environment"
  visible: root.list.rows.length > 0

  Repeater {
    model: root.list.rows
    InfoRow {
      row: modelData.row
      spans: modelData.spans
      summary: root.summary
      actionState: root.actionState
      confirmKey: root.confirmKey
      cursorKey: root.cursorKey
      cursorCol: root.cursorCol
      foreground: root.foreground
      fontFamily: root.fontFamily
      onActionRequested: function (key) { root.envActionRequested(modelData.row, key); }
      onCursorRequested: function (key, col) { root.cursorRequested(key, col); }
      onRevealRequested: function (item) { root.revealRequested(item); }
    }
  }
}
