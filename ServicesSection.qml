import QtQuick
import qs.Commons
import "Model.js" as Model

// Services. What is set up on THIS machine, and nothing else.
//
// The catalogue HubDev offers is larger than that, and the difference used to
// sit here behind a "3 not set up" disclosure. It no longer does. Once the rows
// grew start/stop buttons, that group became the one place where opening
// something revealed rows identical to their neighbours that refuse every verb
// — there is nothing to start, and nothing this panel can do to change that.
// `Model.visibleServices` drops them; a live search still finds them, which is
// where a question about one actually gets asked.
//
// Under a live search this flattens the same way Sites does, and the row order
// is not decided here either: `Model.visibleServices()` returns it, because the
// keyboard cursor walks the order the panel draws and neither could be the
// authority on it.
Section {
  id: root

  property var summary: ({})
  // Model.visibleServices(summary, search) — from the panel, which owns the query.
  property var list: ({ rows: [], searching: false, total: 0 })
  property var actionState: ({ phase: "idle", subject: "", key: "" })
  property string confirmKey: ""
  property string cursorKey: ""
  property int cursorCol: 0

  // Raised rather than handled: this file knows how to arrange services, not
  // how to run anything. BarWidget.qml is still the only file that does I/O.
  signal serviceActionRequested(var service, string key)
  signal cursorRequested(string key, int col)
  signal revealRequested(var item)

  readonly property bool searching: root.list.searching === true
  // Set up here — the denominator for the resting count, and the test for
  // whether this section has anything to say at all.
  readonly property int configured: root.summary.services
    ? (root.summary.services.configured || 0)
    : 0

  title: "Services"
  // Searching counts against the whole catalogue, because that is what a search
  // ranges over and "2/8" is the honest score for it. At rest the denominator is
  // this machine's own: "5/8" printed beside five rows would invite exactly one
  // question and answer it wrong.
  count: root.summary.services
    ? (root.searching
      ? root.list.total + "/" + root.summary.services.total
      : root.summary.services.up + "/" + root.configured)
    : ""
  visible: root.searching
    ? root.list.total > 0
    : root.configured > 0

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
}
