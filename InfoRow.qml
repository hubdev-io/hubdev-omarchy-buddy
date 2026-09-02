import QtQuick
import qs.Commons
import qs.Ui
import "Actions.js" as Actions
import "Model.js" as Model
import "Theme.js" as Theme

// A label on the left, a value on the right, a state dot between them.
//
// The value is what makes the state legible without colour: "stopped",
// "FPM running", "17/18 passing". A theme is free to make its foreground the
// same amber as `warn` (plan §5.3.1), so no row may depend on its dot alone.
//
// Two of these rows can also be acted on — Caddy, and each PHP-FPM pool — and
// reaching one replaces its dot and value with what you can do about it, the
// same trade a service row makes. Which rows those are is not decided here:
// `Model.envRows` stamps a `target` on exactly the two, and everything else in
// this section is a readout that draws no buttons because it has none to draw.
//
// Like a service row, **the row itself does nothing.** Enter on it would have
// to silently pick start or stop, so the row is only ever a place the cursor
// rests on its way to a button, and it paints from that cursor rather than from
// `containsMouse` — CursorSurface's contract.
Item {
  id: root

  // A row from Model.envRows: { key, target?, label, value, level }.
  property var row: ({})
  property var summary: ({})
  // Matched runs of the label under a live query — see SiteRow. Empty at rest,
  // and empty on a row matched only through its fallback text, so a highlight
  // never marks a string that is not on screen.
  property var spans: []
  property var actionState: ({ phase: "idle", subject: "", key: "" })
  property string confirmKey: ""
  property string cursorKey: ""
  property int cursorCol: 0
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property real fontSize: Style.font.bodySmall

  readonly property string label: root.row.label || ""
  readonly property string value: root.row.value || ""
  readonly property string level: root.row.level || "ok"

  readonly property string target: Actions.envTarget(root.row)
  // "" for a row with no target, which can therefore never equal a cursor key
  // — the readout rows are outside the map by construction, not by a check
  // someone has to remember to write.
  readonly property string navKey: root.target === "" ? "" : "env:" + root.target
  readonly property var cols: Actions.navEnvCols(root.summary, root.row)

  readonly property bool current: root.navKey !== "" && root.cursorKey === root.navKey

  // Is this row the one an action is happening to? `subject` is the target.
  readonly property bool mine: root.target !== "" && root.actionState.subject === root.target
  readonly property bool busy: root.mine && root.actionState.phase === "running"
  readonly property bool failed: root.mine && root.actionState.phase === "failed"
  // One action at a time, across the whole panel — BarWidget.runAction enforces
  // it, and dimming every other button is how that becomes visible rather than
  // discovered by clicking.
  readonly property bool blocked: root.actionState.phase === "running"

  signal actionRequested(string key)
  signal cursorRequested(string key, int col)
  signal revealRequested(var item)

  width: parent ? parent.width : implicitWidth
  // The buttons set the height whether or not they are showing, so the section
  // never jumps as the pointer crosses it.
  implicitHeight: Math.max(labelText.implicitHeight, trailing.implicitHeight)
  height: implicitHeight

  onCurrentChanged: if (root.current) root.revealRequested(root)

  CursorSurface {
    anchors.fill: parent
    anchors.leftMargin: -Style.space(4)
    anchors.rightMargin: -Style.space(4)
    // Never the strong fill: the cursor on this row is always out on a button,
    // and that button paints itself.
    hasCursor: false
    current: root.current
    foreground: root.foreground
  }

  // The subtree, not the row — the buttons sit on top and would otherwise take
  // the row's hover the moment the pointer reached them.
  HoverHandler {
    id: rowHover
    onHoveredChanged: if (rowHover.hovered && root.cols.length) root.cursorRequested(root.navKey, 0)
  }

  Text {
    id: labelText
    anchors.left: parent.left
    anchors.right: trailing.left
    anchors.rightMargin: Style.space(8)
    anchors.verticalCenter: parent.verticalCenter
    // The label is the identity of the row and never elides while it fits;
    // the value gets whatever is left, capped, and elides instead. The first
    // cut had this the other way round and rendered "DNS (.t…" beside a health
    // detail long enough to eat the row — the half that had to survive was the
    // half that says which row you are reading.
    text: root.spans.length
      ? Model.highlightHtml(root.label, root.spans, String(Color.accent))
      : root.label
    textFormat: root.spans.length ? Text.StyledText : Text.PlainText
    elide: Text.ElideRight
    color: root.foreground
    opacity: 0.85
    font.family: root.fontFamily
    font.pixelSize: root.fontSize
  }

  Item {
    id: trailing
    anchors.right: parent.right
    anchors.verticalCenter: parent.verticalCenter
    implicitWidth: Math.max(readout.implicitWidth, actions.implicitWidth)
    implicitHeight: Math.max(readout.implicitHeight, actions.implicitHeight)
    width: implicitWidth
    height: implicitHeight

    Row {
      id: readout
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      visible: !root.current && !root.busy && !root.failed
      spacing: Style.space(6)

      StatusDot {
        anchors.verticalCenter: parent.verticalCenter
        level: root.level
        size: Style.space(6)
      }

      Text {
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

    // The refusal, on the row it belongs to. The panel's foot says what went
    // wrong in words; this is what lets you find the row it went wrong on.
    Text {
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      visible: root.failed
      text: Theme.glyphFor("down")
      textFormat: Text.PlainText
      color: Theme.colorFor("down")
      font.family: root.fontFamily
      font.pixelSize: root.fontSize
    }

    // Running. A glyph that turns, because starting Caddy or a PHP pool is
    // slow enough that a still icon would read as a hang.
    Text {
      id: spinner
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      visible: root.busy
      text: Theme.icon("spinner")
      textFormat: Text.PlainText
      color: root.foreground
      opacity: 0.8
      font.family: root.fontFamily
      font.pixelSize: root.fontSize

      RotationAnimator on rotation {
        running: spinner.visible
        from: 0
        to: 360
        duration: 1100
        loops: Animation.Infinite
      }
    }

    Row {
      id: actions
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      visible: root.current && !root.busy && !root.failed
      spacing: Style.space(2)

      Repeater {
        // Actions.envActions() is the allowlist. Two verbs, not three: HubDev
        // has no restart for either Caddy or a PHP pool, and a button meaning
        // stop-then-start would be this panel inventing a verb whose failure
        // halfway through it could not describe.
        model: Actions.envActions()

        PanelActionButton {
          id: button
          readonly property int col: Actions.navColOf(root.cols, modelData.key)
          readonly property bool armed: root.confirmKey !== ""
            && root.confirmKey === Actions.envToken(root.target, modelData.key)

          iconText: Theme.icon(button.armed ? "confirm" : modelData.icon)
          tooltipText: button.armed
            ? "Press again to confirm"
            : modelData.label + " " + Actions.envDisplay(root.summary, root.row)
          foreground: root.foreground
          // Hard-coded red, not the theme's `urgent` (plan §5.3.1): an armed
          // gate is state, and state has to look like state in a theme whose
          // own foreground is amber.
          hoverColor: button.armed ? Theme.colorFor("down") : root.foreground
          fontFamily: root.fontFamily
          fontSize: root.fontSize
          size: Style.space(18)
          enabled: button.col >= 0 && !root.blocked
          hasCursor: root.current && button.col >= 0 && root.cursorCol === button.col
          onHovered: function (isHovered) {
            if (button.col >= 0)
              root.cursorRequested(root.navKey, isHovered ? button.col : root.cursorCol);
          }
          onClicked: root.actionRequested(modelData.key)
        }
      }
    }
  }
}
