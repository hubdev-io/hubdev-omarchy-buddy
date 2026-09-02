import QtQuick
import qs.Commons

// The wide view: sites, services and the machine side by side, with anything
// wrong spanning the full width above them.
//
// Attention goes on top rather than in a column because it is the one section
// whose length is unbounded and whose text wraps — in a third of the width it
// would set the height of all three columns.
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

  readonly property real columnWidth: Math.floor((width - Style.space(20) * 2) / 3)

  spacing: Style.space(14)

  AttentionSection {
    width: root.width
    summary: root.summary
    searching: root.search.active === true
    foreground: root.foreground
    fontFamily: root.fontFamily
  }

  Row {
    width: root.width
    spacing: Style.space(20)

    SitesSection {
      width: root.columnWidth
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
      width: root.columnWidth
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

    Column {
      width: root.columnWidth
      spacing: Style.space(14)

      EnvironmentSection {
        width: parent.width
        summary: root.summary
        searching: root.search.active === true
        foreground: root.foreground
        fontFamily: root.fontFamily
      }

      ExtrasSection {
        width: parent.width
        summary: root.summary
        searching: root.search.active === true
        foreground: root.foreground
        fontFamily: root.fontFamily
      }
    }
  }
}
