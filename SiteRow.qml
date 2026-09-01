import QtQuick
import qs.Commons
import "Model.js" as Model
import "Theme.js" as Theme

// One site. Dot, driver glyph, domain, then the PHP version on the right.
//
// The domain is the identity — it is what the user types and what Caddy
// routes — so the site's `name` is deliberately not shown. On this machine
// the two differ for most sites and showing both doubles the row for nothing.
//
// The row is also the affordance: clicking it opens the site in the desktop's
// browser. That is the one action worth putting on a site here — it is what
// the domain is *for*, it cannot break anything, and it does not need a
// confirm gate, so it does not wait on the action allowlist (plan §6).
Item {
  id: root

  property var site: ({})
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property real fontSize: Style.font.bodySmall

  readonly property string level: Theme.siteLevel(root.site)
  // "" for a domain that is not a plain hostname — Model.siteUrl decides, and
  // a row with no URL simply does not respond.
  readonly property string url: Model.siteUrl(root.site)

  signal activated()

  width: parent ? parent.width : implicitWidth
  implicitHeight: Math.max(domain.implicitHeight, php.implicitHeight)
  height: implicitHeight

  StatusDot {
    id: dot
    anchors.left: parent.left
    anchors.verticalCenter: parent.verticalCenter
    level: root.level
    size: Style.space(6)
  }

  Text {
    id: driver
    anchors.left: dot.right
    anchors.leftMargin: Style.space(7)
    anchors.verticalCenter: parent.verticalCenter
    text: Theme.driverGlyph(root.site.driver)
    color: root.foreground
    opacity: 0.45
    font.family: root.fontFamily
    font.pixelSize: root.fontSize
  }

  Text {
    id: domain
    anchors.left: driver.right
    anchors.leftMargin: Style.space(6)
    anchors.right: php.left
    anchors.rightMargin: Style.space(8)
    anchors.verticalCenter: parent.verticalCenter
    text: root.site.domain || ""
    textFormat: Text.PlainText
    elide: Text.ElideMiddle
    // The domain is the link, so the domain is what underlines — not the row.
    font.underline: mouse.containsMouse
    color: root.foreground
    opacity: mouse.containsMouse ? 1.0 : (root.site.active ? 1.0 : 0.5)
    font.family: root.fontFamily
    font.pixelSize: root.fontSize
  }

  Text {
    id: php
    anchors.right: parent.right
    anchors.verticalCenter: parent.verticalCenter
    text: root.site.php || ""
    textFormat: Text.PlainText
    color: root.foreground
    opacity: 0.5
    font.family: root.fontFamily
    font.pixelSize: root.fontSize
  }

  MouseArea {
    id: mouse
    anchors.fill: parent
    hoverEnabled: true
    enabled: root.url !== ""
    cursorShape: Qt.PointingHandCursor
    onClicked: root.activated()
  }
}
