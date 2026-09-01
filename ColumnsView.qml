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
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property var panel: null

  readonly property real columnWidth: Math.floor((width - Style.space(20) * 2) / 3)

  spacing: Style.space(14)

  AttentionSection {
    width: root.width
    summary: root.summary
    foreground: root.foreground
    fontFamily: root.fontFamily
  }

  Row {
    width: root.width
    spacing: Style.space(20)

    SitesSection {
      width: root.columnWidth
      summary: root.summary
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
    }

    ServicesSection {
      width: root.columnWidth
      summary: root.summary
      foreground: root.foreground
      fontFamily: root.fontFamily
    }

    Column {
      width: root.columnWidth
      spacing: Style.space(14)

      EnvironmentSection {
        width: parent.width
        summary: root.summary
        foreground: root.foreground
        fontFamily: root.fontFamily
      }

      ExtrasSection {
        width: parent.width
        summary: root.summary
        foreground: root.foreground
        fontFamily: root.fontFamily
      }
    }
  }
}
