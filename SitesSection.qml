import QtQuick
import qs.Commons
import "Model.js" as Model

// Sites. Serving first, parked ones collapsed behind a count.
//
// The grouping and the sort are Model.siteGroups' job, not this file's — 15
// sites on this machine against the 1 lerd Glance assumes is exactly the kind
// of rule that deserves a test, and a .qml cannot have one.
Section {
  id: root

  property var summary: ({})
  property bool expanded: false

  // Raised rather than handled: this file knows how to arrange sites, not how
  // to launch anything. BarWidget.qml is still the only file that does I/O.
  signal siteActivated(var site)
  signal siteActionRequested(var site, string key)

  readonly property var groups: Model.siteGroups(root.summary)

  title: "Sites"
  count: root.summary.sites ? root.summary.sites.active + "/" + root.summary.sites.total : ""
  visible: root.summary.sites && root.summary.sites.total > 0

  Repeater {
    model: root.groups.active
    SiteRow {
      site: modelData
      summary: root.summary
      foreground: root.foreground
      fontFamily: root.fontFamily
      onActivated: root.siteActivated(modelData)
      onActionRequested: function (key) { root.siteActionRequested(modelData, key); }
    }
  }

  CollapseRow {
    visible: root.groups.inactiveCount > 0
    expanded: root.expanded
    label: root.groups.inactiveCount + (root.groups.inactiveCount === 1 ? " parked site" : " parked sites")
    foreground: root.foreground
    fontFamily: root.fontFamily
    onToggled: root.expanded = !root.expanded
  }

  Repeater {
    model: root.expanded ? root.groups.inactive : []
    SiteRow {
      site: modelData
      summary: root.summary
      foreground: root.foreground
      fontFamily: root.fontFamily
      onActivated: root.siteActivated(modelData)
      onActionRequested: function (key) { root.siteActionRequested(modelData, key); }
    }
  }
}
