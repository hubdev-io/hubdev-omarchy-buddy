import QtQuick
import qs.Commons
import "Model.js" as Model

// Sites. Serving first, parked ones collapsed behind a count — and under a
// live search, one flat list ranked by how well each row matched.
//
// This file no longer decides any of that. `Model.visibleSites()` returns the
// three buckets already in draw order, because the keyboard cursor has to walk
// the same order the panel draws and neither of the two could be the authority
// on it. What is left here is the arrangement: a Repeater per bucket.
Section {
  id: root

  property var summary: ({})
  // Model.visibleSites(summary, search, expanded) — from the panel, which owns
  // both the query and whether the parked rows are showing.
  property var list: ({ serving: [], parked: [], collapse: null, searching: false, total: 0 })
  property string cursorKey: ""
  property int cursorCol: 0

  // Raised rather than handled: this file knows how to arrange sites, not how
  // to launch anything. BarWidget.qml is still the only file that does I/O.
  signal siteActivated(var site)
  signal siteActionRequested(var site, string key)
  signal collapseToggled()
  // Both halves of the shared cursor: where a pointer has moved it, and which
  // row needs scrolling back into view because the keyboard moved it.
  signal cursorRequested(string key, int col)
  signal revealRequested(var item)

  readonly property bool searching: root.list.searching === true

  title: "Sites"
  count: root.summary.sites
    ? (root.searching
      ? root.list.total + "/" + root.summary.sites.total
      : root.summary.sites.active + "/" + root.summary.sites.total)
    : ""
  // A section with no matches is not drawn at all, the same as one with no
  // rows — the panel says "nothing matches" once, at the top, rather than
  // once per empty heading.
  visible: root.summary.sites && root.summary.sites.total > 0
    && (!root.searching || root.list.total > 0)

  Repeater {
    model: root.list.serving
    SiteRow {
      site: modelData.site
      spans: modelData.spans
      summary: root.summary
      cursorKey: root.cursorKey
      cursorCol: root.cursorCol
      foreground: root.foreground
      fontFamily: root.fontFamily
      onActivated: root.siteActivated(modelData.site)
      onActionRequested: function (key) { root.siteActionRequested(modelData.site, key); }
      onCursorRequested: function (key, col) { root.cursorRequested(key, col); }
      onRevealRequested: function (item) { root.revealRequested(item); }
    }
  }

  CollapseRow {
    visible: root.list.collapse !== null
    expanded: root.list.collapse ? root.list.collapse.expanded : false
    label: root.list.collapse ? root.list.collapse.label : ""
    navKey: "sites:collapse"
    cursorKey: root.cursorKey
    foreground: root.foreground
    fontFamily: root.fontFamily
    onToggled: root.collapseToggled()
    onCursorRequested: function (key, col) { root.cursorRequested(key, col); }
    onRevealRequested: function (item) { root.revealRequested(item); }
  }

  Repeater {
    model: root.list.parked
    SiteRow {
      site: modelData.site
      spans: modelData.spans
      summary: root.summary
      cursorKey: root.cursorKey
      cursorCol: root.cursorCol
      foreground: root.foreground
      fontFamily: root.fontFamily
      onActivated: root.siteActivated(modelData.site)
      onActionRequested: function (key) { root.siteActionRequested(modelData.site, key); }
      onCursorRequested: function (key, col) { root.cursorRequested(key, col); }
      onRevealRequested: function (item) { root.revealRequested(item); }
    }
  }
}
