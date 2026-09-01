import QtQuick
import qs.Commons
import "Theme.js" as Theme

// The bar mark: a monochrome glyph taking the bar foreground, plus a state dot
// drawn ONLY when something is wrong (plan §5.1 — quiet when healthy).
//
// No I/O, no timers, no logic. `level` in, pixels out.
Item {
  id: root

  // "ok" | "warn" | "down"
  property string level: "ok"
  property color foreground: Color.foreground
  property real glyphSize: Style.font.caption
  property bool stale: false

  implicitWidth: canvas.implicitWidth
  implicitHeight: canvas.implicitHeight

  Item {
    id: canvas
    anchors.fill: parent
    implicitWidth: mark.implicitWidth
    implicitHeight: mark.implicitHeight

    Text {
      id: mark
      anchors.centerIn: parent
      // nf-fa-server. A real HubDev mark is a Phase 5 asset; the glyph is
      // honest about being a placeholder without looking like one.
      text: ""
      font.family: Style.font.family
      font.pixelSize: root.glyphSize
      // Chrome inherits the theme (§5.3.1). Only the dot carries state colour.
      color: root.foreground
      // A snapshot that failed to refresh is dimmed rather than hidden — the
      // numbers on screen are still the last true ones, just not current.
      opacity: root.stale ? 0.45 : 1.0

      Behavior on opacity {
        NumberAnimation { duration: 150 }
      }
    }

    // The state dot. Colour AND position AND glyph all carry state, because a
    // theme is free to make its foreground the same amber as `warn` (§5.3.1).
    Rectangle {
      id: dot
      visible: Theme.dotVisible(root.level)
      width: Math.max(6, root.glyphSize * 0.42)
      height: width
      radius: width / 2
      color: Theme.colorFor(root.level)
      anchors.right: mark.right
      anchors.top: mark.top
      anchors.rightMargin: -width * 0.30
      anchors.topMargin: -height * 0.15

      // A hairline in the bar background separates the dot from the glyph
      // beneath it at any theme contrast.
      border.width: 1
      border.color: Color.background

      // `down` pulses; `warn` does not. Motion is the third channel, so the
      // two faulty states are still distinguishable in a monochrome capture.
      SequentialAnimation on opacity {
        running: root.level === "down"
        loops: Animation.Infinite
        NumberAnimation { from: 1.0; to: 0.35; duration: 700; easing.type: Easing.InOutQuad }
        NumberAnimation { from: 0.35; to: 1.0; duration: 700; easing.type: Easing.InOutQuad }
      }

      onVisibleChanged: if (!visible) opacity = 1.0
    }
  }
}
