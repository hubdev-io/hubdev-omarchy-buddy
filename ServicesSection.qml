import QtQuick
import qs.Commons
import "Model.js" as Model

// Services. What is set up here, then everything HubDev offers that was never
// configured, collapsed — listing those as "stopped" reads as things broken.
Section {
  id: root

  property var summary: ({})
  property bool expanded: false

  readonly property var groups: Model.serviceGroups(root.summary)

  title: "Services"
  count: root.summary.services ? root.summary.services.up + "/" + root.summary.services.total : ""
  visible: root.summary.services && root.summary.services.total > 0

  Repeater {
    model: root.groups.installed
    ServiceRow {
      service: modelData
      foreground: root.foreground
      fontFamily: root.fontFamily
    }
  }

  CollapseRow {
    visible: root.groups.availableCount > 0
    expanded: root.expanded
    label: root.groups.availableCount + " not set up"
    foreground: root.foreground
    fontFamily: root.fontFamily
    onToggled: root.expanded = !root.expanded
  }

  Repeater {
    model: root.expanded ? root.groups.available : []
    ServiceRow {
      service: modelData
      foreground: root.foreground
      fontFamily: root.fontFamily
    }
  }
}
