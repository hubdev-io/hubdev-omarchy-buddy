import QtQuick
import qs.Commons

// The compact view: one column, every section stacked. This is the default
// because it is the shape that fits beside a bar without covering the work.
Column {
  id: root

  property var summary: ({})
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property var panel: null

  spacing: Style.space(12)

  AttentionSection {
    summary: root.summary
    foreground: root.foreground
    fontFamily: root.fontFamily
  }

  EnvironmentSection {
    summary: root.summary
    foreground: root.foreground
    fontFamily: root.fontFamily
  }

  SitesSection {
    summary: root.summary
    foreground: root.foreground
    fontFamily: root.fontFamily
    onSiteActivated: function (site) {
      if (root.panel)
        root.panel.openSite(site);
    }
  }

  ServicesSection {
    summary: root.summary
    foreground: root.foreground
    fontFamily: root.fontFamily
  }

  ExtrasSection {
    summary: root.summary
    foreground: root.foreground
    fontFamily: root.fontFamily
  }
}
