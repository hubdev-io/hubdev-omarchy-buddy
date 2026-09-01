import QtQuick
import Quickshell
import qs.Commons
import qs.Ui
import "Actions.js" as Actions
import "Model.js" as Model
import "Theme.js" as Theme

// The popout. A thin header (mark, name, version, update), one of two views of
// the same summary, and the hand-offs at the bottom.
//
// This file draws; it does not decide. Every grouping, sort, threshold and
// piece of wording comes from Model.js, which `node --test` runs directly —
// the panel is the one place where that discipline pays twice, because a view
// is the hardest thing here to test and the easiest to get subtly wrong.
Panel {
  id: root
  moduleName: "io.hubdev.buddy"
  manageIpc: false

  property var anchorItem: null
  property var hostWidget: null
  property var summary: Model.empty()

  readonly property string fontFamily: root.bar ? root.bar.fontFamily : Style.font.family

  // "dense" or "columns", persisted in the bar's own settings entry so the
  // choice survives a shell restart the same way the clock's format does.
  readonly property string view: String(setting("view", "dense")) === "columns" ? "columns" : "dense"
  readonly property string otherView: view === "columns" ? "dense" : "columns"
  readonly property int viewWidth: Style.space(view === "columns" ? 820 : 420)

  function refresh() {
    if (root.hostWidget)
      root.hostWidget.refresh("full");
  }

  // Apply locally first so the toggle is instant, then hand the entry to the
  // shell, which writes shell.json and sends the same value back through the
  // bar. Skipping the local half makes the button feel broken on a slow write.
  function persistSettings(values) {
    var entry = { id: root.moduleName };
    for (var existing in root.settings) {
      if (existing !== "id")
        entry[existing] = root.settings[existing];
    }
    for (var key in values)
      entry[key] = values[key];

    root.settings = entry;
    if (root.hostWidget && "settings" in root.hostWidget)
      root.hostWidget.settings = entry;
    if (root.bar && root.bar.shell && typeof root.bar.shell.updateEntryInline === "function")
      root.bar.shell.updateEntryInline(root.moduleName, entry);
  }

  function toggleView() {
    root.persistSettings({ view: root.otherView });
  }

  // Clicking a site opens it. The panel closes because the browser is about to
  // take the screen anyway, and a popout left hanging behind it reads as a
  // click that did not land.
  function openSite(site) {
    var url = Model.siteUrl(site);
    if (!url)
      return;
    if (root.hostWidget && typeof root.hostWidget.openUrl === "function")
      root.hostWidget.openUrl(url);
    root.close();
  }

  // The three hover actions on a site row: a terminal in the project, the
  // project in the file manager, the project in the editor.
  //
  // The panel decides nothing here either. Actions.js turns (summary, site,
  // key) into an argv array or into [], and [] means the click is dropped —
  // an unknown verb, a name that cannot go on a command line, or a site this
  // snapshot no longer lists. Same shape as openSite: validate in tested JS,
  // hand a fixed argv to the one file that spawns.
  //
  // It closes for the same reason openSite does — a terminal, a file manager
  // or an editor window is about to take the screen, and a popout left hanging
  // behind it reads as a click that did not land.
  function runSiteAction(site, key) {
    var argv = Actions.siteArgv(root.summary, site, key);
    if (!argv.length)
      return;
    if (root.hostWidget && typeof root.hostWidget.runDetached === "function")
      root.hostWidget.runDetached(argv);
    root.close();
  }

  // The escape hatch the plan is explicit about: anything long, interactive or
  // destructive belongs in the GUI, and the panel says so by opening it rather
  // than pretending to be a console.
  function openHubDev() {
    if (root.bar && typeof root.bar.run === "function")
      root.bar.run("hubdev");
    root.close();
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.hostWidget || root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(root.viewWidth)
    // Capped at ~75% of what the screen leaves us, and the middle scrolls —
    // this machine has 15 sites where lerd Glance assumes 1, so an uncapped
    // panel would run off the bottom of the display (plan §5.2).
    contentHeight: panel.fittedContentHeight(
      header.height + Style.space(12) + body.implicitHeight + Style.space(12) + footer.height,
      Math.round(panel.availableCardHeight * 0.75))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent

      onCloseRequested: root.close()
      onTabRequested: function (direction) {
        if (root.bar && typeof root.bar.switchPanelFrom === "function")
          root.bar.switchPanelFrom(root.hostWidget || root, direction);
      }
      onTextKey: function (t) {
        if (t === "v")
          root.toggleView();
        else if (t === "r")
          root.refresh();
      }

      // ------------------------------------------------------------ header --
      Item {
        id: header
        anchors.top: parent.top
        anchors.left: parent.left
        anchors.right: parent.right
        height: Style.space(24)

        Row {
          anchors.left: parent.left
          anchors.verticalCenter: parent.verticalCenter
          spacing: Style.space(7)

          Mark {
            anchors.verticalCenter: parent.verticalCenter
            level: root.summary.level
            foreground: root.barForeground
            glyphSize: Style.font.subtitle
          }

          Text {
            anchors.verticalCenter: parent.verticalCenter
            text: "HubDev"
            textFormat: Text.PlainText
            color: root.barForeground
            font.family: root.fontFamily
            font.pixelSize: Style.font.subtitle
            font.bold: true
          }

          Text {
            anchors.verticalCenter: parent.verticalCenter
            visible: root.summary.version !== ""
            text: "v" + root.summary.version
            textFormat: Text.PlainText
            color: root.barForeground
            opacity: 0.5
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }
        }

        Row {
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          spacing: Style.space(8)

          Row {
            anchors.verticalCenter: parent.verticalCenter
            visible: root.summary.updateAvailable !== null
            spacing: Style.space(4)

            StatusDot {
              anchors.verticalCenter: parent.verticalCenter
              level: "warn"
              size: Style.space(6)
            }

            Text {
              anchors.verticalCenter: parent.verticalCenter
              text: root.summary.updateAvailable + " available"
              textFormat: Text.PlainText
              color: root.barForeground
              opacity: 0.65
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
            }
          }

          // The icon is the view you would switch to, not the one you are in.
          PanelActionButton {
            anchors.verticalCenter: parent.verticalCenter
            iconText: Theme.icon(root.otherView === "columns" ? "view-columns" : "view-dense")
            tooltipText: root.otherView === "columns" ? "Three columns (v)" : "Dense list (v)"
            foreground: root.barForeground
            fontFamily: root.fontFamily
            fontSize: Style.font.body
            size: Style.space(22)
            bordered: true
            onClicked: root.toggleView()
          }
        }
      }

      // -------------------------------------------------------------- body --
      Flickable {
        id: body
        anchors.top: header.bottom
        anchors.topMargin: Style.space(12)
        anchors.bottom: footer.top
        anchors.bottomMargin: Style.space(12)
        anchors.left: parent.left
        anchors.right: parent.right
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        contentWidth: width
        contentHeight: content.implicitHeight
        implicitHeight: content.implicitHeight

        Column {
          id: content
          width: body.width
          spacing: Style.space(10)

          Text {
            width: parent.width
            visible: !root.summary.reachable
            text: root.summary.issues.length
              ? root.summary.issues[0]
              : "HubDev is not answering."
            textFormat: Text.PlainText
            wrapMode: Text.WordWrap
            color: root.barForeground
            opacity: 0.75
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
          }

          Loader {
            id: viewLoader
            width: parent.width
            visible: root.summary.reachable
            active: root.summary.reachable
            source: Qt.resolvedUrl(root.view === "columns" ? "ColumnsView.qml" : "DenseView.qml")
            onLoaded: {
              item.summary = Qt.binding(function () { return root.summary; });
              item.foreground = Qt.binding(function () { return root.barForeground; });
              item.fontFamily = Qt.binding(function () { return root.fontFamily; });
              item.panel = root;
              item.width = Qt.binding(function () { return viewLoader.width; });
            }
          }
        }
      }

      // ------------------------------------------------------------ footer --
      Column {
        id: footer
        anchors.bottom: parent.bottom
        anchors.left: parent.left
        anchors.right: parent.right
        spacing: Style.space(10)

        PanelSeparator {
          width: parent.width
          foreground: root.barForeground
        }

        Row {
          width: parent.width
          spacing: Style.space(6)

          Button {
            width: (parent.width - parent.spacing) / 2
            text: "Open HubDev"
            iconText: Theme.icon("external-link")
            bordered: true
            foreground: root.barForeground
            fontFamily: root.fontFamily
            fontSize: Style.font.bodySmall
            onClicked: root.openHubDev()
          }

          Button {
            width: (parent.width - parent.spacing) / 2
            text: "Refresh"
            iconText: Theme.icon("refresh")
            bordered: true
            foreground: root.barForeground
            fontFamily: root.fontFamily
            fontSize: Style.font.bodySmall
            onClicked: root.refresh()
          }
        }
      }
    }
  }
}
