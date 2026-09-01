import QtQuick
import qs.Commons
import "Model.js" as Model

// Services. What is set up here, then everything HubDev offers that was never
// configured, collapsed — listing those as "stopped" reads as things broken.
//
// Under a live search this flattens the same way Sites does, and for the same
// reason: the collapsed group is where the thing you cannot find has been.
Section {
  id: root

  property var summary: ({})
  property var search: ({ active: false, services: [] })
  property bool expanded: false

  readonly property var groups: Model.serviceGroups(root.summary)
  readonly property bool searching: root.search.active === true
  readonly property var matches: root.searching ? root.search.services : []

  title: "Services"
  count: root.summary.services
    ? (root.searching
      ? root.matches.length + "/" + root.summary.services.total
      : root.summary.services.up + "/" + root.summary.services.total)
    : ""
  visible: root.summary.services && root.summary.services.total > 0
    && (!root.searching || root.matches.length > 0)

  // ---- filtered ------------------------------------------------------------

  Repeater {
    model: root.matches
    ServiceRow {
      service: modelData.service
      spans: modelData.spans
      foreground: root.foreground
      fontFamily: root.fontFamily
    }
  }

  // ---- unfiltered ----------------------------------------------------------

  Repeater {
    model: root.searching ? [] : root.groups.installed
    ServiceRow {
      service: modelData
      foreground: root.foreground
      fontFamily: root.fontFamily
    }
  }

  CollapseRow {
    visible: !root.searching && root.groups.availableCount > 0
    expanded: root.expanded
    label: root.groups.availableCount + " not set up"
    foreground: root.foreground
    fontFamily: root.fontFamily
    onToggled: root.expanded = !root.expanded
  }

  Repeater {
    model: (!root.searching && root.expanded) ? root.groups.available : []
    ServiceRow {
      service: modelData
      foreground: root.foreground
      fontFamily: root.fontFamily
    }
  }
}
