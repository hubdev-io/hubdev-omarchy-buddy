import QtQuick
import qs.Commons
import "Model.js" as Model

// Services. What is set up here, then everything HubDev offers that was never
// configured, collapsed — listing those as "stopped" reads as things broken.
//
// Under a live search this flattens the same way Sites does, and for the same
// reason: the collapsed group is where the thing you cannot find has been.
//
// Like SitesSection, this file no longer decides the order. `Model.visibleServices()`
// returns the three buckets already in draw order, because the keyboard cursor
// walks the same order the panel draws and neither could be the authority on it.
Section {
  id: root

  property var summary: ({})
  // Model.visibleServices(summary, search, expanded) — from the panel, which
  // owns both the query and whether the unconfigured rows are showing.
  property var list: ({ rows: [], others: [], collapse: null, searching: false, total: 0 })
  property var actionState: ({ phase: "idle", subject: "", key: "" })
  property string confirmKey: ""
  property string cursorKey: ""
  property int cursorCol: 0

  // Raised rather than handled: this file knows how to arrange services, not
  // how to run anything. BarWidget.qml is still the only file that does I/O.
  signal serviceActionRequested(var service, string key)
  signal collapseToggled()
  signal cursorRequested(string key, int col)
  signal revealRequested(var item)

  readonly property bool searching: root.list.searching === true

  title: "Services"
  count: root.summary.services
    ? (root.searching
      ? root.list.total + "/" + root.summary.services.total
      : root.summary.services.up + "/" + root.summary.services.total)
    : ""
  visible: root.summary.services && root.summary.services.total > 0
    && (!root.searching || root.list.total > 0)

  Repeater {
    model: root.list.rows
    ServiceRow {
      service: modelData.service
      spans: modelData.spans
      summary: root.summary
      actionState: root.actionState
      confirmKey: root.confirmKey
      cursorKey: root.cursorKey
      cursorCol: root.cursorCol
      foreground: root.foreground
      fontFamily: root.fontFamily
      onActionRequested: function (key) { root.serviceActionRequested(modelData.service, key); }
      onCursorRequested: function (key, col) { root.cursorRequested(key, col); }
      onRevealRequested: function (item) { root.revealRequested(item); }
    }
  }

  // No `navKey`, and that is the one place this section deliberately differs
  // from Sites. What is behind this count is now only what it always claimed —
  // services HubDev offers that this machine never set up — and
  // `Actions.serviceArgv` refuses every verb on those, so a keyboard cursor
  // that could open the group would be walking into somewhere with nothing to
  // press. It stays a mouse disclosure, which is what it always was.
  CollapseRow {
    visible: root.list.collapse !== null
    expanded: root.list.collapse ? root.list.collapse.expanded : false
    label: root.list.collapse ? root.list.collapse.label : ""
    foreground: root.foreground
    fontFamily: root.fontFamily
    onToggled: root.collapseToggled()
  }

  Repeater {
    model: root.list.others
    ServiceRow {
      service: modelData.service
      spans: modelData.spans
      summary: root.summary
      actionState: root.actionState
      confirmKey: root.confirmKey
      cursorKey: root.cursorKey
      cursorCol: root.cursorCol
      foreground: root.foreground
      fontFamily: root.fontFamily
      onActionRequested: function (key) { root.serviceActionRequested(modelData.service, key); }
      onCursorRequested: function (key, col) { root.cursorRequested(key, col); }
      onRevealRequested: function (item) { root.revealRequested(item); }
    }
  }
}
