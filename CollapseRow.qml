import QtQuick
import qs.Commons
import "Theme.js" as Theme

// The "· 3 parked" line that stands in for a collapsed group. Clicking it
// expands in place; nothing is ever hidden without saying how much.
Item {
  id: root

  property string label: ""
  property bool expanded: false
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property real fontSize: Style.font.caption

  signal toggled()

  width: parent ? parent.width : implicitWidth
  implicitHeight: text.implicitHeight + Style.space(2)
  height: implicitHeight

  Text {
    id: text
    anchors.left: parent.left
    anchors.verticalCenter: parent.verticalCenter
    text: Theme.icon(root.expanded ? "caret-down" : "caret-right") + "  " + root.label
    textFormat: Text.PlainText
    color: root.foreground
    opacity: mouse.containsMouse ? 0.85 : 0.5
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
    onClicked: root.toggled()
  }
}
