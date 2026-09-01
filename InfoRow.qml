import QtQuick
import qs.Commons

// A label on the left, a value on the right, a state dot between them.
//
// The value is what makes the state legible without colour: "stopped",
// "FPM running", "17/18 passing". A theme is free to make its foreground the
// same amber as `warn` (plan §5.3.1), so no row may depend on its dot alone.
Item {
  id: root

  property string label: ""
  property string value: ""
  property string level: "ok"
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property real fontSize: Style.font.bodySmall

  width: parent ? parent.width : implicitWidth
  implicitHeight: Math.max(labelText.implicitHeight, valueText.implicitHeight)
  height: implicitHeight

  Text {
    id: labelText
    anchors.left: parent.left
    anchors.right: dot.left
    anchors.rightMargin: Style.space(8)
    anchors.verticalCenter: parent.verticalCenter
    // The label is the identity of the row and never elides while it fits;
    // the value gets whatever is left, capped, and elides instead. The first
    // cut had this the other way round and rendered "DNS (.t…" beside a health
    // detail long enough to eat the row — the half that had to survive was the
    // half that says which row you are reading.
    text: root.label
    textFormat: Text.PlainText
    elide: Text.ElideRight
    color: root.foreground
    opacity: 0.85
    font.family: root.fontFamily
    font.pixelSize: root.fontSize
  }

  StatusDot {
    id: dot
    anchors.right: valueText.left
    anchors.rightMargin: Style.space(6)
    anchors.verticalCenter: parent.verticalCenter
    level: root.level
    size: Style.space(6)
  }

  Text {
    id: valueText
    anchors.right: parent.right
    anchors.verticalCenter: parent.verticalCenter
    width: Math.min(implicitWidth, Math.round(root.width * 0.62))
    horizontalAlignment: Text.AlignRight
    elide: Text.ElideRight
    text: root.value
    textFormat: Text.PlainText
    color: root.foreground
    opacity: root.level === "ok" || root.level === "idle" ? 0.6 : 0.95
    font.family: root.fontFamily
    font.pixelSize: root.fontSize
  }
}
