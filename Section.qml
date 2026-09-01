import QtQuick
import qs.Commons
import qs.Ui

// A panel section: a small-caps title, an optional count on the right, a rule,
// and whatever rows the caller puts inside.
//
// Sections with nothing in them are not drawn at all (plan §5.2) — the caller
// sets `visible` from its own row count, because only the caller knows whether
// zero means "empty" or "not asked for".
Column {
  id: root

  property string title: ""
  property string count: ""
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family

  default property alias content: body.children

  width: parent ? parent.width : implicitWidth
  spacing: Style.space(4)

  Item {
    width: parent.width
    height: Math.max(title.implicitHeight, count.implicitHeight)

    PanelSectionHeader {
      id: title
      anchors.left: parent.left
      anchors.verticalCenter: parent.verticalCenter
      text: root.title
      foreground: root.foreground
      fontFamily: root.fontFamily
    }

    Text {
      id: count
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      visible: root.count !== ""
      text: root.count
      textFormat: Text.PlainText
      color: root.foreground
      opacity: 0.55
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
    }
  }

  PanelSeparator {
    width: parent.width
    foreground: root.foreground
  }

  Column {
    id: body
    width: parent.width
    spacing: Style.space(2)
  }
}
