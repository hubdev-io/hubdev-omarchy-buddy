import QtQuick
import qs.Commons

// Tunnels and backups: one line each, and nothing at all when there is nothing
// to say. Both are usually empty, which is why they share a section rather
// than each owning a heading of their own.
Section {
  id: root

  property var summary: ({})

  readonly property bool hasTunnels: root.summary.tunnels && root.summary.tunnels.length > 0
  readonly property bool hasBackups: root.summary.backups && root.summary.backups.count > 0

  title: "Also"
  visible: root.hasTunnels || root.hasBackups

  Repeater {
    model: root.hasTunnels ? root.summary.tunnels : []
    InfoRow {
      label: "Tunnel · " + (modelData.site || "")
      value: modelData.running ? "open" : "closed"
      level: modelData.running ? "ok" : "idle"
      foreground: root.foreground
      fontFamily: root.fontFamily
    }
  }

  InfoRow {
    visible: root.hasBackups
    label: "Backups"
    value: root.summary.backups.count + (root.summary.backups.sizeLabel
      ? " · " + root.summary.backups.sizeLabel : "")
    level: "idle"
    foreground: root.foreground
    fontFamily: root.fontFamily
  }
}
