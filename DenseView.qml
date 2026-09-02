import QtQuick
import qs.Commons

// The compact view: one column, every section stacked. This is the default
// because it is the shape that fits beside a bar without covering the work.
Column {
  id: root

  property var summary: ({})
  property var search: ({ active: false, sites: [], services: [] })
  // Both lists in draw order (Model.visibleSites / Model.visibleServices), plus
  // the panel's cursor, which now walks the two of them end to end.
  property var list: ({ serving: [], parked: [], collapse: null, searching: false, total: 0 })
  property var services: ({ rows: [], others: [], collapse: null, searching: false, total: 0 })
  property var actionState: ({ phase: "idle", subject: "", key: "" })
  property string confirmKey: ""
  property string cursorKey: ""
  property int cursorCol: 0
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property var panel: null

  spacing: Style.space(12)

  AttentionSection {
    summary: root.summary
    searching: root.search.active === true
    foreground: root.foreground
    fontFamily: root.fontFamily
  }

  EnvironmentSection {
    summary: root.summary
    searching: root.search.active === true
    foreground: root.foreground
    fontFamily: root.fontFamily
  }

  SitesSection {
    summary: root.summary
    list: root.list
    cursorKey: root.cursorKey
    cursorCol: root.cursorCol
    foreground: root.foreground
    fontFamily: root.fontFamily
    onSiteActivated: function (site) {
      if (root.panel)
        root.panel.openSite(site);
    }
    onSiteActionRequested: function (site, key) {
      if (root.panel)
        root.panel.runSiteAction(site, key);
    }
    onCollapseToggled: {
      if (root.panel)
        root.panel.sitesExpanded = !root.panel.sitesExpanded;
    }
    onCursorRequested: function (key, col) {
      if (root.panel)
        root.panel.setCursor(key, col);
    }
    onRevealRequested: function (item) {
      if (root.panel)
        root.panel.revealRow(item);
    }
  }

  ServicesSection {
    summary: root.summary
    list: root.services
    actionState: root.actionState
    confirmKey: root.confirmKey
    cursorKey: root.cursorKey
    cursorCol: root.cursorCol
    foreground: root.foreground
    fontFamily: root.fontFamily
    onServiceActionRequested: function (service, key) {
      if (root.panel)
        root.panel.runServiceAction(service, key);
    }
    onCollapseToggled: {
      if (root.panel)
        root.panel.servicesExpanded = !root.panel.servicesExpanded;
    }
    onCursorRequested: function (key, col) {
      if (root.panel)
        root.panel.setCursor(key, col);
    }
    onRevealRequested: function (item) {
      if (root.panel)
        root.panel.revealRow(item);
    }
  }

  ExtrasSection {
    summary: root.summary
    searching: root.search.active === true
    foreground: root.foreground
    fontFamily: root.fontFamily
  }
}
