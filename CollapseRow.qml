import QtQuick
import qs.Commons
import qs.Ui
import "Theme.js" as Theme

// The "· 3 parked" line that stands in for a collapsed group. Clicking it —
// or pressing Enter on it — expands in place; nothing is ever hidden without
// saying how much.
//
// It is a cursor stop in its own right, and it has to be: with the parked
// rows collapsed there is otherwise no way to reach them from the keyboard at
// all. Like every other row here it paints from the cursor rather than from
// `containsMouse` — see the comment at the top of SiteRow.qml.
Item {
  id: root

  property string label: ""
  property bool expanded: false
  // "" leaves the row unreachable by keyboard, which is right for a group the
  // panel's cursor does not walk.
  property string navKey: ""
  property string cursorKey: ""
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property real fontSize: Style.font.caption

  readonly property bool hasCursor: root.navKey !== "" && root.cursorKey === root.navKey
  // A row outside the panel's cursor map — Services still has one — has no
  // shared cursor to conflict with, so its own hover is the only signal it
  // has. That is the one place CursorSurface's "never read containsMouse"
  // rule does not apply, because there is nothing to be inconsistent with.
  readonly property bool hot: root.navKey !== "" ? root.hasCursor : mouse.containsMouse

  signal toggled()
  signal cursorRequested(string key, int col)
  signal revealRequested(var item)

  width: parent ? parent.width : implicitWidth
  implicitHeight: text.implicitHeight + Style.space(2)
  height: implicitHeight

  onHasCursorChanged: if (root.hasCursor) root.revealRequested(root)

  CursorSurface {
    anchors.fill: parent
    anchors.leftMargin: -Style.space(4)
    anchors.rightMargin: -Style.space(4)
    hasCursor: root.hot
    foreground: root.foreground
  }

  Text {
    id: text
    anchors.left: parent.left
    anchors.verticalCenter: parent.verticalCenter
    text: Theme.icon(root.expanded ? "caret-down" : "caret-right") + "  " + root.label
    textFormat: Text.PlainText
    color: root.foreground
    opacity: root.hot ? 0.85 : 0.5
    font.family: root.fontFamily
    font.pixelSize: root.fontSize

    Behavior on opacity {
      NumberAnimation { duration: 100 }
    }
  }

  MouseArea {
    id: mouse
    anchors.fill: parent
    hoverEnabled: true
    cursorShape: Qt.PointingHandCursor
    onEntered: if (root.navKey !== "") root.cursorRequested(root.navKey, 0)
    onClicked: root.toggled()
  }
}
