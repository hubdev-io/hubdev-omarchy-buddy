import QtQuick
import qs.Commons
import "Theme.js" as Theme

// One state dot. `level` in, pixels out — no logic, no I/O.
//
// `idle` is drawn dimmer rather than in a different hue: a stopped-on-purpose
// service and a broken one must not be told apart by saturation alone, so the
// rows that matter also carry their state in the value text beside them.
Rectangle {
  id: root

  property string level: "ok"
  property real size: Style.space(7)

  implicitWidth: root.size
  implicitHeight: root.size
  width: root.size
  height: root.size
  radius: root.size / 2
  color: Theme.colorFor(root.level)
  opacity: root.level === "idle" ? 0.45 : 1.0

  Behavior on opacity {
    NumberAnimation { duration: 120 }
  }
}
