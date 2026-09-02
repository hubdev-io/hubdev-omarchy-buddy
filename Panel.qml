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

  // ---------------------------------------------------------------- search --
  //
  // Exactly what the user typed, and nothing else: no field, no focus, no mode
  // to enter. The panel already holds the keyboard when it opens, so the first
  // printable key IS the search, and an empty query is indistinguishable from
  // never having searched.
  //
  // The one cost is that the bare-letter shortcuts had to move — `v` and `r`
  // are now Alt+V and Alt+R — because a panel that filters on `v` cannot also
  // toggle its layout on it, and half this machine's sites start with a letter
  // that used to be a command.
  property string query: ""

  readonly property var search: Model.searchResults(root.summary, root.query)

  // A query is a question about what is on screen right now. Reopening the
  // panel asks it again from scratch; leaving yesterday's filter in place would
  // make a panel that opens showing three of fifteen sites and no reason why.
  onOpenedChanged: {
    root.query = "";
    root.clearCursor();
  }

  // Every keystroke re-ranks the list, so the row the cursor was on is not the
  // row it would be on now. Dropping it is the honest answer, and it puts
  // Enter back on the top match — which is what someone still typing means.
  onQueryChanged: root.clearCursor()

  function typeQuery(text) {
    // A cap, not a limit anyone will reach: this is a filter over fifteen rows,
    // and an unbounded string held on a held-down key is the only way it grows.
    if (root.query.length < 64)
      root.query += text;
  }

  function eraseQuery(all) {
    root.query = all ? "" : root.query.slice(0, -1);
  }

  // Escape means "undo the narrowing", and only then "close". Anything else
  // makes the key that clears a filter also throw the panel away.
  function dismiss() {
    if (root.cursorKey !== "" || root.query !== "") {
      root.clearCursor();
      root.query = "";
    } else {
      root.close();
    }
  }

  // ---------------------------------------------------------------- cursor --
  //
  // The keyboard cursor. Up/Down walk the site rows, Left/Right walk the
  // actions on the row the cursor is on, Enter or Space presses what it is
  // pointing at.
  //
  // Two ideas make this small. The first is that the cursor is a *key*, not an
  // index: `site:<ref>`, resolved against the map every time. The snapshot
  // refreshes under the panel every few seconds and a search re-orders
  // everything on each keystroke — an index would silently come to mean a
  // different row, which is the worst possible bug for a control that runs
  // things. A key that no longer exists simply resolves to nothing.
  //
  // The second is the shell's own rule, from CursorSurface: **the mouse moves
  // this same cursor.** Rows paint from `hasCursor`, never from
  // `containsMouse`, so there is exactly one highlight on screen no matter
  // which device put it there.
  property string cursorKey: ""
  property int cursorCol: 0

  // Which parked sites are showing. Hoisted out of SitesSection because the
  // cursor has to know whether those rows are drawn before it can walk them,
  // and because Enter on the collapsed count is what expands it.
  property bool sitesExpanded: false

  // The panel's draw order and the cursor's map, from the same two calls.
  readonly property var siteList: Model.visibleSites(root.summary, root.search, root.sitesExpanded)
  readonly property var nav: Actions.navRows(root.summary, root.siteList)

  function moveCursor(dx, dy) {
    var next = Actions.navMove(root.nav, root.cursorKey, root.cursorCol, dx, dy);
    root.cursorKey = next.key;
    root.cursorCol = next.col;
  }

  // What a hovering pointer calls. Same state, same paint — see above.
  function setCursor(key, col) {
    root.cursorKey = key;
    root.cursorCol = col;
  }

  function clearCursor() {
    root.cursorKey = "";
    root.cursorCol = 0;
  }

  // Space: press what the cursor is on, or nothing at all.
  function activateCursor() {
    var target = Actions.navTarget(root.nav, root.cursorKey, root.cursorCol);
    if (!target)
      return;
    if (target.kind === "collapse")
      root.sitesExpanded = !root.sitesExpanded;
    else if (target.action === "open")
      root.openSite(target.site);
    else
      root.runSiteAction(target.site, target.action);
  }

  // Enter: the same, but with the one fallback Space is not allowed. With no
  // cursor and a live search it opens the best match — type three letters,
  // press Enter, and the site opens without ever touching an arrow key.
  function activateReturn() {
    if (root.cursorKey !== "")
      root.activateCursor();
    else
      root.activateTop();
  }

  // Enter opens the best match. It is only ever offered when the search has
  // narrowed to something — with no query there is no "the" site, and Enter
  // does nothing rather than guessing.
  function activateTop() {
    if (root.search.active && root.search.sites.length)
      root.openSite(root.search.sites[0].site);
  }

  // Scroll the cursor back into view. Rows ask for this when they become
  // current; the panel is the only thing that knows where the fold is.
  function revealRow(item) {
    if (!item || !item.height || !body.height)
      return;
    var pos = item.mapToItem(content, 0, 0);
    var pad = Style.space(6);
    var top = pos.y - pad;
    var bottom = pos.y + item.height + pad;
    var limit = Math.max(0, body.contentHeight - body.height);
    if (top < body.contentY)
      body.contentY = Math.max(0, Math.min(top, limit));
    else if (bottom > body.contentY + body.height)
      body.contentY = Math.max(0, Math.min(bottom - body.height, limit));
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
      header.height + searchBox.height + searchBox.anchors.topMargin
        + Style.space(12) + body.implicitHeight + Style.space(12) + footer.height,
      Math.round(panel.availableCardHeight * 0.75))

    // KeyCatcher, not qs.Ui's PanelKeyCatcher: the shared one spends h/j/k/l/x
    // on a row cursor this panel never had, which is four of the letters in
    // `hubdev.test`. See the comment at the top of that file.
    KeyCatcher {
      id: keyCatcher
      anchors.fill: parent

      onCloseRequested: root.dismiss()
      onTabRequested: function (direction) {
        if (root.bar && typeof root.bar.switchPanelFrom === "function")
          root.bar.switchPanelFrom(root.hostWidget || root, direction);
      }
      onTextEntered: function (t) { root.typeQuery(t); }
      onEraseRequested: function (all) { root.eraseQuery(all); }
      onMoveRequested: function (dx, dy) { root.moveCursor(dx, dy); }
      onActivateRequested: root.activateCursor()
      onReturnRequested: root.activateReturn()
      onCommandKey: function (letter) {
        if (letter === "v")
          root.toggleView();
        else if (letter === "r")
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
            tooltipText: root.otherView === "columns" ? "Three columns (Alt+V)" : "Dense list (Alt+V)"
            foreground: root.barForeground
            fontFamily: root.fontFamily
            fontSize: Style.font.body
            size: Style.space(22)
            bordered: true
            onClicked: root.toggleView()
          }
        }
      }

      // ------------------------------------------------------------ search --
      //
      // Zero-height when there is no query, so the panel is exactly what it was
      // before anyone typed — the feature costs nothing on screen until it is
      // being used.
      SearchField {
        id: searchBox
        anchors.top: header.bottom
        anchors.topMargin: visible ? Style.space(10) : 0
        anchors.left: parent.left
        anchors.right: parent.right
        visible: root.search.active
        height: visible ? implicitHeight : 0
        query: root.query
        matches: root.search.total
        searched: root.search.searched
        foreground: root.barForeground
        fontFamily: root.fontFamily
      }

      // -------------------------------------------------------------- body --
      Flickable {
        id: body
        anchors.top: searchBox.bottom
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

          // A filter that matches nothing hides every section, and a panel that
          // empties itself with no explanation reads as broken rather than as
          // narrow. One line is the whole fix.
          Text {
            width: parent.width
            visible: root.summary.reachable && root.search.active && root.search.total === 0
            text: "Nothing matches \u201C" + root.query + "\u201D"
            textFormat: Text.PlainText
            wrapMode: Text.WordWrap
            elide: Text.ElideRight
            color: root.barForeground
            opacity: 0.6
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
              item.search = Qt.binding(function () { return root.search; });
              item.list = Qt.binding(function () { return root.siteList; });
              item.cursorKey = Qt.binding(function () { return root.cursorKey; });
              item.cursorCol = Qt.binding(function () { return root.cursorCol; });
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
