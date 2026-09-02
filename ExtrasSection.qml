import QtQuick
import qs.Commons

// Tunnels and backups: one line each, and nothing at all when there is nothing
// to say. Both are usually empty, which is why they share a section rather
// than each owning a heading of their own.
Section {
  id: root

  property var summary: ({})
  // A filter narrows the panel to the two lists that can be searched. This
  // section is not one of them, so while a query is live it steps out of the
  // way rather than sitting above three matched rows as unrelated noise.
  property bool searching: false

  readonly property bool hasTunnels: root.summary.tunnels && root.summary.tunnels.length > 0
  readonly property bool hasBackups: root.summary.backups && root.summary.backups.count > 0

  title: "Also"
  visible: !root.searching && (root.hasTunnels || root.hasBackups)

  Repeater {
    model: root.hasTunnels ? root.summary.tunnels : []
    // A row object, not three properties: InfoRow reads its label, value and
    // level off one `row` now, because the Environment rows it also draws carry
    // a `target` alongside them that decides whether the row can be acted on.
    // Nothing here carries one, so nothing here grows a button.
    InfoRow {
      row: ({
        label: "Tunnel · " + (modelData.site || ""),
        value: modelData.running ? "open" : "closed",
        level: modelData.running ? "ok" : "idle"
      })
      foreground: root.foreground
      fontFamily: root.fontFamily
    }
  }

  InfoRow {
    visible: root.hasBackups
    row: ({
      label: "Backups",
      value: root.summary.backups.count + (root.summary.backups.sizeLabel
        ? " · " + root.summary.backups.sizeLabel : ""),
      level: "idle"
    })
    foreground: root.foreground
    fontFamily: root.fontFamily
  }
}
