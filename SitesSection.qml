import QtQuick
import qs.Commons
import "Model.js" as Model

// Sites. Serving first, parked ones collapsed behind a count.
//
// The grouping and the sort are Model.siteGroups' job, not this file's — 15
// sites on this machine against the 1 lerd Glance assumes is exactly the kind
// of rule that deserves a test, and a .qml cannot have one.
//
// While a search is live the section is a different shape: one flat list, ranked
// by how well each row matched, with the serving/parked split dropped. That is
// not a shortcut — finding a PARKED site is the search's whole point, and the
// collapsed row is precisely what was hiding it.
Section {
  id: root

  property var summary: ({})
  property var search: ({ active: false, sites: [] })
  property bool expanded: false

  // Raised rather than handled: this file knows how to arrange sites, not how
  // to launch anything. BarWidget.qml is still the only file that does I/O.
  signal siteActivated(var site)
  signal siteActionRequested(var site, string key)

  readonly property var groups: Model.siteGroups(root.summary)
  readonly property bool searching: root.search.active === true
  readonly property var matches: root.searching ? root.search.sites : []

  title: "Sites"
  count: root.summary.sites
    ? (root.searching
      ? root.matches.length + "/" + root.summary.sites.total
      : root.summary.sites.active + "/" + root.summary.sites.total)
    : ""
  // A section with no matches is not drawn at all, the same as one with no
  // rows — the panel says "nothing matches" once, at the top, rather than
  // once per empty heading.
  visible: root.summary.sites && root.summary.sites.total > 0
    && (!root.searching || root.matches.length > 0)

  // ---- filtered ------------------------------------------------------------

  Repeater {
    model: root.matches
    SiteRow {
      site: modelData.site
      spans: modelData.spans
      summary: root.summary
      foreground: root.foreground
      fontFamily: root.fontFamily
      onActivated: root.siteActivated(modelData.site)
      onActionRequested: function (key) { root.siteActionRequested(modelData.site, key); }
    }
  }

  // ---- unfiltered ----------------------------------------------------------

  Repeater {
    model: root.searching ? [] : root.groups.active
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
    visible: !root.searching && root.groups.inactiveCount > 0
    expanded: root.expanded
    label: root.groups.inactiveCount + (root.groups.inactiveCount === 1 ? " parked site" : " parked sites")
    foreground: root.foreground
    fontFamily: root.fontFamily
    onToggled: root.expanded = !root.expanded
  }

  Repeater {
    model: (!root.searching && root.expanded) ? root.groups.inactive : []
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
