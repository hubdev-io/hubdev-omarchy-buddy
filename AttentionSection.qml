import QtQuick
import qs.Commons

// What is actually wrong, in the same plain words the tooltip uses. Drawn only
// when there is something to say — a panel that always has a "Needs attention"
// heading trains people to stop reading it.
Section {
  id: root

  property var summary: ({})

  title: "Needs attention"
  count: root.summary.issues && root.summary.issues.length > 1 ? String(root.summary.issues.length) : ""
  visible: root.summary.issues && root.summary.issues.length > 0

  Repeater {
    model: root.summary.issues || []

    Item {
      width: parent.width
      implicitHeight: issue.implicitHeight
      height: implicitHeight

      StatusDot {
        id: dot
        anchors.left: parent.left
        anchors.top: parent.top
        anchors.topMargin: Math.round(issue.font.pixelSize * 0.4)
        level: root.summary.level === "down" ? "down" : "warn"
        size: Style.space(6)
      }

      Text {
        id: issue
        anchors.left: dot.right
        anchors.leftMargin: Style.space(7)
        anchors.right: parent.right
        text: modelData
        textFormat: Text.PlainText
        wrapMode: Text.WordWrap
        color: root.foreground
        opacity: 0.9
        font.family: root.fontFamily
        font.pixelSize: Style.font.bodySmall
      }
    }
  }
}
