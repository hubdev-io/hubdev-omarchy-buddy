import QtQuick
import qs.Commons
import qs.Ui
import "Actions.js" as Actions
import "Model.js" as Model
import "Theme.js" as Theme

// One service. Dot, display name, then version and port on the right — the
// two facts you actually need when something cannot connect.
//
// Reaching the row replaces those two with what you can do about them: `start`
// on a stopped service, `restart` and `stop` on a running one. Never all three,
// because `Actions.serviceArgv` refuses the verbs that could not apply, and a
// button that would refuse is not drawn as a button you could press.
//
// Unlike a site row, **the row itself does nothing.** A domain is somewhere to
// go; a service is not, and Enter on the row would have to silently pick one of
// start/stop/restart. So the row is a place the cursor rests on its way to a
// button, and it paints from that cursor rather than from `containsMouse` —
// CursorSurface's contract, and the reason there is one highlight on screen
// however it got there. See the comment at the top of SiteRow.qml.
Item {
  id: root

  property var service: ({})
  property var summary: ({})
  // Matched runs of the display name — see SiteRow.
  property var spans: []
  // BarWidget.actionState, verbatim: which action is running or has just
  // refused, and on what. The row works out whether it is the subject.
  property var actionState: ({ phase: "idle", subject: "", key: "" })
  // Actions.confirmToken(...) for the one button that is armed, or "".
  property string confirmKey: ""
  property string cursorKey: ""
  property int cursorCol: 0
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

  readonly property string ref: Actions.serviceRef(root.service)
  // The same key Actions.navServices builds, derived the same way — if the two
  // ever disagree the row is simply never current, which shows up immediately
  // rather than subtly.
  readonly property string navKey: "svc:" + root.ref
  readonly property var cols: Actions.navServiceCols(root.summary, root.service)

  readonly property bool current: root.cursorKey !== "" && root.cursorKey === root.navKey

  // Is this row the one an action is happening to? `subject` is the service
  // name, so this is asked here rather than routed here.
  readonly property bool mine: root.ref !== "" && root.actionState.subject === root.ref
  readonly property bool busy: root.mine && root.actionState.phase === "running"
  readonly property bool failed: root.mine && root.actionState.phase === "failed"
  // One action at a time (BarWidget.runAction enforces it too). Dimming every
  // other button while one runs is how that rule becomes visible rather than
  // being discovered by clicking.
  readonly property bool blocked: root.actionState.phase === "running"

  signal actionRequested(string key)
  signal cursorRequested(string key, int col)
  signal revealRequested(var item)

  width: parent ? parent.width : implicitWidth
  // The buttons set the height whether or not they are showing, so the list
  // never jumps as the pointer crosses it.
  implicitHeight: Math.max(name.implicitHeight, trailing.implicitHeight)
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
  // the row's hover the moment the pointer reached them, which is to say they
  // would vanish under the cursor reaching for them.
  HoverHandler {
    id: rowHover
    onHoveredChanged: if (rowHover.hovered && root.cols.length) root.cursorRequested(root.navKey, 0)
  }

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
    anchors.right: trailing.left
    anchors.rightMargin: Style.space(8)
    anchors.verticalCenter: parent.verticalCenter
    text: root.spans.length
      ? Model.highlightHtml(root.service.display || root.service.name || "", root.spans, String(Color.accent))
      : (root.service.display || root.service.name || "")
    textFormat: root.spans.length ? Text.StyledText : Text.PlainText
    elide: Text.ElideRight
    color: root.foreground
    opacity: root.service.up || root.current ? 1.0 : 0.6
    font.family: root.fontFamily
    font.pixelSize: root.fontSize
  }

  Item {
    id: trailing
    anchors.right: parent.right
    anchors.verticalCenter: parent.verticalCenter
    implicitWidth: Math.max(detailText.implicitWidth, actions.implicitWidth)
    implicitHeight: Math.max(detailText.implicitHeight, actions.implicitHeight)
    width: implicitWidth
    height: implicitHeight

    Text {
      id: detailText
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      visible: !root.current && !root.busy && !root.failed
      text: root.detail
      textFormat: Text.PlainText
      color: root.foreground
      opacity: 0.5
      font.family: root.fontFamily
      font.pixelSize: root.fontSize
    }

    // The refusal, on the row it belongs to. The panel's foot says what went
    // wrong in words; this is what lets you find the row it went wrong on in a
    // list of eight.
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

    // Running. A glyph that turns, because a service start is the one thing
    // here slow enough that a still icon would read as a hang.
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
        // Actions.serviceActions() is the allowlist. Adding a button means
        // adding a row there, which is what the tests read.
        model: Actions.serviceActions()

        PanelActionButton {
          id: button
          // Where this button sits in the row's cursor columns, which is not
          // its position in the Row: a column only exists for a verb that
          // would actually run, so `start` has one or `stop` and `restart` do,
          // never both.
          readonly property int col: Actions.navColOf(root.cols, modelData.key)
          // Armed: pressed once, waiting for the second press that sends it.
          readonly property bool armed: root.confirmKey !== ""
            && root.confirmKey === Actions.confirmToken(root.ref, modelData.key)

          iconText: Theme.icon(button.armed ? "confirm" : modelData.icon)
          tooltipText: button.armed
            ? "Press again to confirm"
            : modelData.label + " " + (root.service.display || root.ref)
          foreground: root.foreground
          // Hard-coded red, not the theme's `urgent` (plan §5.3.1): an armed
          // gate is state, and state has to look like state in a theme whose
          // own foreground is amber.
          hoverColor: button.armed ? Theme.colorFor("down") : root.foreground
          fontFamily: root.fontFamily
          fontSize: root.fontSize
          size: Style.space(18)
          // Nothing to run for a verb this service's current state refuses, a
          // service the snapshot no longer lists, or one that was never set up
          // — and nothing at all while another action is in flight.
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
