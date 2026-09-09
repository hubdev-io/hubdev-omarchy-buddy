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
// The row is also the affordance: clicking it, or pressing Enter on it, opens
// the site in the desktop's browser. That is the one action worth putting on
// the row *itself* — it is what the domain is for, it cannot break anything,
// and it needs no confirm gate.
//
// Reaching the row reveals three more, in place of the PHP version they cover
// (lerd's rule, and the plan's §5.3): a terminal in the project, the project
// in the file manager, the project in the editor. All three are detached,
// produce no output and cannot escalate — see Actions.js, which owns the argv
// and the validation. This file knows which key it sent, and nothing else.
//
// **It paints from the cursor, never from `containsMouse`.** That is
// CursorSurface's contract, and the reason is that the keyboard and the mouse
// drive the same cursor: a pointer entering the row moves it here, exactly as
// an arrow key would. Reading hover directly is how a panel ends up with two
// highlights on screen and no way to say which one Enter would press.
Item {
  id: root

  property var site: ({})
  property var summary: ({})
  // Which runs of the domain matched the live search, as [start, length] pairs.
  // Empty is the normal state and the only one that draws plain text.
  property var spans: []
  // The panel's cursor, verbatim. The row works out whether it is the one.
  property string cursorKey: ""
  property int cursorCol: 0
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property real fontSize: Style.font.bodySmall

  readonly property string level: Theme.siteLevel(root.site)
  // "" for a domain that is not a plain hostname — Model.siteUrl decides, and
  // a row with no URL simply does not respond.
  readonly property string url: Model.siteUrl(root.site)

  // The same key Actions.navRows builds, derived the same way. If these two
  // ever disagree the row is simply never current, which is visible
  // immediately rather than subtly wrong.
  readonly property string navKey: "site:" + Actions.siteRef(root.site)
  readonly property var cols: Actions.navCols(root.summary, root.site, root.url)

  // Current: the cursor is somewhere on this row. Has-cursor: it is on the row
  // *itself*, which is the column that opens the site.
  readonly property bool current: root.cursorKey !== "" && root.cursorKey === root.navKey
  readonly property bool hasCursor: root.current && root.cols.length > 0
    && root.cols[Math.min(root.cursorCol, root.cols.length - 1)] === "open"

  signal activated()
  signal actionRequested(string key)
  signal cursorRequested(string key, int col)
  signal revealRequested(var item)

  width: parent ? parent.width : implicitWidth
  // The action buttons set the height whether or not they are showing. Letting
  // the cursor change it would make the whole list jump every time the pointer
  // crosses a row.
  implicitHeight: Math.max(domain.implicitHeight, trailing.implicitHeight)
  height: implicitHeight

  // Arrowing onto a row below the fold has to bring it into view, or the
  // cursor walks off the bottom of a panel that looks like it stopped
  // responding. The row asks; the panel, which is the only thing that knows
  // where the fold is, does it.
  onCurrentChanged: if (root.current) root.revealRequested(root)

  CursorSurface {
    anchors.fill: parent
    anchors.leftMargin: -Style.space(4)
    anchors.rightMargin: -Style.space(4)
    hasCursor: root.hasCursor
    // Still marked while the cursor is out on the action buttons: the softer
    // fill says "this is the row you are working on", the button's own says
    // "this is what Enter presses".
    current: root.current && !root.hasCursor
    foreground: root.foreground
  }

  // Hover over the row OR anything in it. A plain MouseArea cannot answer that
  // — the action buttons sit on top of it and take its hover the moment the
  // pointer reaches them, which would make the buttons vanish under the cursor
  // that was reaching for them. HoverHandler reports the subtree.
  HoverHandler {
    id: rowHover
    onHoveredChanged: if (rowHover.hovered && root.cols.length) root.cursorRequested(root.navKey, 0)
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
    // Theme.driverGlyph answers from a closed table, but the format is pinned
    // anyway — see Mark.qml.
    textFormat: Text.PlainText
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
    // of its two states. The domain therefore elides at the same point the
    // actions are showing or not: they appear beside it, never over it.
    anchors.right: trailing.left
    anchors.rightMargin: Style.space(8)
    anchors.verticalCenter: parent.verticalCenter
    // Marked-up only while something is matched. Model.highlightHtml escapes
    // the text it wraps — the domain is data, and this is the one place in the
    // panel where data becomes markup.
    text: root.spans.length
      ? Model.highlightHtml(root.site.domain || "", root.spans, String(Color.accent))
      : (root.site.domain || "")
    textFormat: root.spans.length ? Text.StyledText : Text.PlainText
    // ElideMiddle keeps the TLD visible, which is what tells .test from .lab
    // apart — but Qt only elides styled text from the right, so a highlighted
    // row that has to elide loses the end rather than the middle. Matching rows
    // are few and the panel is sized for the longest domain, so this is a
    // corner, not a compromise.
    elide: root.spans.length ? Text.ElideRight : Text.ElideMiddle
    // The domain is the link, so the domain is what underlines — not the row.
    // It underlines exactly when Enter would open it, which is also why it
    // stops once the cursor moves out onto an action button.
    font.underline: root.hasCursor
    color: root.foreground
    opacity: root.hasCursor ? 1.0 : (root.site.active ? 1.0 : 0.5)
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
      visible: !root.current
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
      visible: root.current
      spacing: Style.space(2)

      Repeater {
        // Actions.siteActions() is the allowlist. Adding a button means adding
        // a row there, which is what the tests read.
        model: Actions.siteActions()

        PanelActionButton {
          id: button
          // Where this button sits in the row's cursor columns — which is not
          // its position in the Row, because a column only exists for an
          // action that would actually run.
          readonly property int col: Actions.navColOf(root.cols, modelData.key)

          iconText: Theme.icon(modelData.icon)
          tooltipText: modelData.label
          foreground: root.foreground
          fontFamily: root.fontFamily
          fontSize: root.fontSize
          size: Style.space(18)
          // Nothing to run for a site the snapshot no longer lists, or one
          // whose name cannot go on a command line — the button dims rather
          // than failing silently on click, and the cursor cannot stop on it.
          enabled: button.col >= 0
          // The shell's own hook for exactly this: paint the keyboard cursor
          // identically to a mouse hover, so one highlight serves both.
          hasCursor: root.current && button.col >= 0 && root.cursorCol === button.col
          onHovered: function (isHovered) {
            if (button.col >= 0)
              root.cursorRequested(root.navKey, isHovered ? button.col : 0);
          }
          onClicked: root.actionRequested(modelData.key)
        }
      }
    }
  }
}
