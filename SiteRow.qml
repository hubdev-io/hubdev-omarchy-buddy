import QtQuick
import qs.Commons
import qs.Ui
import "Actions.js" as Actions
import "Model.js" as Model
import "Theme.js" as Theme

// One site. Dot, driver glyph, domain, then the PHP version on the right.
//
// The domain is the identity — it is what the user types and what Caddy
// routes — so the site's `name` is deliberately not shown. On this machine
// the two differ for most sites and showing both doubles the row for nothing.
//
// The row is also the affordance: clicking it opens the site in the desktop's
// browser. That is the one action worth putting on the row *itself* — it is
// what the domain is for, it cannot break anything, and it needs no confirm
// gate.
//
// Hovering reveals three more, in place of the PHP version they cover (lerd's
// rule, and the plan's §5.3): a terminal in the project, the project in the
// file manager, the project in the editor. All three are detached, produce no
// output and cannot escalate — see Actions.js, which owns the argv and the
// validation. This file knows which key it sent, and nothing else.
Item {
  id: root

  property var site: ({})
  property var summary: ({})
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property real fontSize: Style.font.bodySmall

  readonly property string level: Theme.siteLevel(root.site)
  // "" for a domain that is not a plain hostname — Model.siteUrl decides, and
  // a row with no URL simply does not respond.
  readonly property string url: Model.siteUrl(root.site)

  // Hover over the row OR anything in it. A plain MouseArea cannot answer that
  // — the action buttons sit on top of it and take its hover the moment the
  // pointer reaches them, which would make the buttons vanish under the cursor
  // that was reaching for them. HoverHandler reports the subtree.
  readonly property bool hovered: rowHover.hovered

  signal activated()
  signal actionRequested(string key)

  width: parent ? parent.width : implicitWidth
  // The action buttons set the height whether or not they are showing. Letting
  // hover change it would make the whole list jump every time the pointer
  // crosses a row.
  implicitHeight: Math.max(domain.implicitHeight, trailing.implicitHeight)
  height: implicitHeight

  HoverHandler {
    id: rowHover
  }

  // Declared BEFORE the trailing actions so those stack above it and receive
  // their own clicks. Everything else in the row is a Text and takes nothing.
  MouseArea {
    id: mouse
    anchors.fill: parent
    hoverEnabled: true
    enabled: root.url !== ""
    cursorShape: Qt.PointingHandCursor
    onClicked: root.activated()
  }

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
    // Anchored to the trailing block, whose width is reserved for the widest
    // of its two states. The domain therefore elides at the same point hovered
    // or not: the actions appear beside it, never over it.
    anchors.right: trailing.left
    anchors.rightMargin: Style.space(8)
    anchors.verticalCenter: parent.verticalCenter
    text: root.site.domain || ""
    textFormat: Text.PlainText
    elide: Text.ElideMiddle
    // The domain is the link, so the domain is what underlines — not the row.
    // It stops underlining once the pointer is over an action button, which is
    // correct: clicking there no longer opens the site.
    font.underline: mouse.containsMouse
    color: root.foreground
    opacity: mouse.containsMouse ? 1.0 : (root.site.active ? 1.0 : 0.5)
    font.family: root.fontFamily
    font.pixelSize: root.fontSize
  }

  Item {
    id: trailing
    anchors.right: parent.right
    anchors.verticalCenter: parent.verticalCenter
    implicitWidth: Math.max(php.implicitWidth, actions.implicitWidth)
    implicitHeight: Math.max(php.implicitHeight, actions.implicitHeight)
    width: implicitWidth
    height: implicitHeight

    Text {
      id: php
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      visible: !root.hovered
      text: root.site.php || ""
      textFormat: Text.PlainText
      color: root.foreground
      opacity: 0.5
      font.family: root.fontFamily
      font.pixelSize: root.fontSize
    }

    Row {
      id: actions
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      visible: root.hovered
      spacing: Style.space(2)

      Repeater {
        // Actions.siteActions() is the allowlist. Adding a button means adding
        // a row there, which is what the tests read.
        model: Actions.siteActions()

        PanelActionButton {
          iconText: Theme.icon(modelData.icon)
          tooltipText: modelData.label
          foreground: root.foreground
          fontFamily: root.fontFamily
          fontSize: root.fontSize
          size: Style.space(18)
          // Nothing to run for a site the snapshot no longer lists, or one
          // whose name cannot go on a command line — the button dims rather
          // than failing silently on click.
          enabled: Actions.siteArgv(root.summary, root.site, modelData.key).length > 0
          onClicked: root.actionRequested(modelData.key)
        }
      }
    }
  }
}
