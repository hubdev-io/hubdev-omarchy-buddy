import QtQuick
import qs.Commons
import "Theme.js" as Theme

// The search box. Nothing until the first character, then one slim line between
// the header and the list.
//
// Deliberately not a TextField. There is no field to focus, no cursor to place
// and no click target — the panel already owns the keyboard, so the box is a
// readout of a string the panel holds, and every key that edits it is handled in
// one place (KeyCatcher). A real input would mean juggling active focus with the
// key router for the sake of features a filter does not need.
Item {
  id: root

  property string query: ""
  property int matches: 0
  property int searched: 0
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family

  readonly property bool empty: root.query !== "" && root.matches === 0

  width: parent ? parent.width : implicitWidth
  implicitHeight: box.implicitHeight
  height: implicitHeight

  Rectangle {
    id: box
    width: parent.width
    implicitHeight: Math.max(text.implicitHeight, count.implicitHeight) + Style.space(10)
    height: implicitHeight
    radius: Math.max(Style.cornerRadius, Style.space(6))
    // A tint of the panel's own foreground rather than a colour of its own:
    // the box has to read as part of the panel in every Omarchy theme, and the
    // one thing guaranteed to contrast with the panel background is the colour
    // its text is already drawn in.
    color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.09)

    Text {
      id: glyph
      anchors.left: parent.left
      anchors.leftMargin: Style.space(9)
      anchors.verticalCenter: parent.verticalCenter
      text: Theme.icon("search")
      textFormat: Text.PlainText
      color: root.foreground
      opacity: 0.5
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
    }

    Text {
      id: text
      anchors.left: glyph.right
      anchors.leftMargin: Style.space(7)
      anchors.right: count.left
      anchors.rightMargin: Style.space(8)
      anchors.verticalCenter: parent.verticalCenter
      text: root.query
      textFormat: Text.PlainText
      elide: Text.ElideLeft
      // Accent, and only here: this is the one string on screen the user wrote
      // rather than HubDev, and it is what every highlight below is echoing.
      color: Color.accent
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
      horizontalAlignment: Text.AlignLeft
    }

    // A caret, because a box that shows typed text and does not blink reads as
    // a label rather than as the thing the keyboard is going into.
    // Positioned with `x`, not an anchor. The caret sits at the end of the
    // text, and the text's own width has to be free to come from the box —
    // anchoring one to the other in both directions is a binding loop, which
    // Qt resolves by putting the caret at the far left and saying so in a log
    // nobody reads.
    Rectangle {
      id: caret
      x: text.x + Math.min(text.contentWidth + Style.space(2), text.width)
      anchors.verticalCenter: parent.verticalCenter
      width: Math.max(1, Style.space(1))
      height: Style.font.bodySmall
      color: Color.accent

      SequentialAnimation on opacity {
        running: root.visible
        loops: Animation.Infinite
        NumberAnimation { to: 0.15; duration: 500 }
        NumberAnimation { to: 1.0; duration: 500 }
      }
    }

    Text {
      id: count
      anchors.right: parent.right
      anchors.rightMargin: Style.space(9)
      anchors.verticalCenter: parent.verticalCenter
      text: root.matches + " of " + root.searched
      textFormat: Text.PlainText
      color: root.empty ? Theme.colorFor("warn") : root.foreground
      opacity: root.empty ? 0.9 : 0.5
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
    }
  }
}
