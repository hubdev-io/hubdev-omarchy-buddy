import QtQuick
import qs.Commons
import "Model.js" as Model

// The machine itself: Caddy, each PHP, Docker, Node, DNS, hosts, and the
// doctor's roll-up. This is what stands in for lerd Glance's Resources column
// (plan §5.2) — HubDev has no CPU figure, and its memory figure costs a Docker
// stats sample per service, so a 30-second poll is the wrong place for it.
Section {
  id: root

  property var summary: ({})
  // A filter narrows the panel to the two lists that can be searched. This
  // section is not one of them, so while a query is live it steps out of the
  // way rather than sitting above three matched rows as unrelated noise.
  property bool searching: false

  readonly property var rows: Model.envRows(root.summary)

  title: "Environment"
  visible: !root.searching && root.rows.length > 0

  Repeater {
    model: root.rows
    InfoRow {
      label: modelData.label
      value: modelData.value
      level: modelData.level
      foreground: root.foreground
      fontFamily: root.fontFamily
    }
  }
}
