import QtQuick
import qs.Commons
import "Model.js" as Model
import "Theme.js" as Theme

// One service. Dot, display name, then version and port on the right — the
// two facts you actually need when something cannot connect.
Item {
  id: root

  property var service: ({})
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property real fontSize: Style.font.bodySmall

  readonly property string level: Theme.serviceLevel(root.service)
  readonly property string detail: {
    var parts = [];
    if (root.service.version)
      parts.push(Model.versionLabel(root.service.version));
    if (root.service.port)
      parts.push(":" + root.service.port);
    return parts.join("  ");
  }

  width: parent ? parent.width : implicitWidth
  implicitHeight: Math.max(name.implicitHeight, detailText.implicitHeight)
  height: implicitHeight

  StatusDot {
    id: dot
    anchors.left: parent.left
    anchors.verticalCenter: parent.verticalCenter
    level: root.level
    size: Style.space(6)
  }

  Text {
    id: name
    anchors.left: dot.right
    anchors.leftMargin: Style.space(7)
    anchors.right: detailText.left
    anchors.rightMargin: Style.space(8)
    anchors.verticalCenter: parent.verticalCenter
    text: root.service.display || root.service.name || ""
    textFormat: Text.PlainText
    elide: Text.ElideRight
    color: root.foreground
    opacity: root.service.up ? 1.0 : 0.6
    font.family: root.fontFamily
    font.pixelSize: root.fontSize
  }

  Text {
    id: detailText
    anchors.right: parent.right
    anchors.verticalCenter: parent.verticalCenter
    text: root.detail
    textFormat: Text.PlainText
    color: root.foreground
    opacity: 0.5
    font.family: root.fontFamily
    font.pixelSize: root.fontSize
  }
}
