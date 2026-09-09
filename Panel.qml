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

  // --------------------------------------------------------------- services --
  //
  // Start, stop and restart, and the two things that make them different from
  // every action before them: they can fail, and one of them arms first.
  //
  // The panel still decides nothing about what may run — `Actions.serviceArgv`
  // turns (summary, service, key) into an argv or into [], and [] drops the
  // press. What is decided here is only the gesture: whether this press arms a
  // button or sends it.
  //
  // **The panel does not close.** Every action before this one handed the
  // screen to something else — a browser, a terminal, an editor — so leaving a
  // popout behind it read as a click that had not landed. This one has its
  // answer *in the panel*: the spinner, then the dot going green. Closing would
  // throw away the only feedback there is.
  //
  // The armed button is held for four seconds. That is long enough to read the
  // question at the foot of the panel and short enough that a gate left armed
  // by a misclick is gone before it can be pressed by accident later.
  property string confirmKey: ""

  readonly property var actionState: root.hostWidget && root.hostWidget.actionState
    ? root.hostWidget.actionState
    : ({ key: "", subject: "", label: "", done: "", phase: "idle", message: "" })

  Timer {
    id: confirmTimer
    interval: 4000
    repeat: false
    onTriggered: root.confirmKey = ""
  }

  function disarm() {
    root.confirmKey = "";
    confirmTimer.stop();
  }

  function runServiceAction(service, key) {
    var argv = Actions.serviceArgv(root.summary, service, key);
    if (!argv.length)
      return;

    var ref = Actions.serviceRef(service);
    var token = Actions.confirmToken(ref, key);

    // Arm on the first press of a gated verb; send on the second. Pressing a
    // *different* button re-arms rather than firing, which is the whole point
    // of keying the gate on the button and not on the row.
    if (Actions.needsConfirm(key) && root.confirmKey !== token) {
      root.confirmKey = token;
      confirmTimer.restart();
      return;
    }

    root.disarm();
    if (root.hostWidget && typeof root.hostWidget.runAction === "function") {
      root.hostWidget.runAction({
        argv: argv,
        key: key,
        subject: ref,
        label: Actions.serviceActionLabel(key, service.display || ref),
        doneLabel: Actions.serviceDoneLabel(key, service.display || ref),
        timeoutMs: Actions.timeoutMs(key)
      });
    }
  }

  // Caddy and each PHP-FPM pool, from their Environment rows.
  //
  // The twin of `runServiceAction`, and deliberately its twin rather than a
  // generalisation of it: the two share a shape but not a subject, and folding
  // them together would mean one function that has to ask what kind of thing it
  // was handed before it can do anything. `Actions.envArgv` returns [] for a row
  // that carries no target, so the readout rows in that section drop the press
  // without this file needing to know which rows those are.
  //
  // Stopping Caddy takes every site on the machine offline at once. It is
  // gated exactly like a service stop — no extra ceremony for the bigger blast
  // radius, because a gate that escalates by importance is a gate people learn
  // to click through twice.
  function runEnvAction(row, key) {
    var argv = Actions.envArgv(root.summary, row, key);
    if (!argv.length)
      return;

    var target = Actions.envTarget(row);
    var token = Actions.envToken(target, key);
    var display = Actions.envDisplay(root.summary, row);

    if (Actions.envNeedsConfirm(key) && root.confirmKey !== token) {
      root.confirmKey = token;
      confirmTimer.restart();
      return;
    }

    root.disarm();
    if (root.hostWidget && typeof root.hostWidget.runAction === "function") {
      root.hostWidget.runAction({
        argv: argv,
        key: key,
        subject: target,
        label: Actions.envActionLabel(key, display),
        doneLabel: Actions.envDoneLabel(key, display),
        timeoutMs: Actions.envTimeoutMs(key)
      });
    }
  }

  // What the foot of the panel is saying, if anything. One line, four states,
  // in the order they matter: what went wrong, what is being asked, what is
  // happening, what just happened. Empty means the row is not drawn at all.
  //
  // One line rather than four pieces of chrome, because these are mutually
  // exclusive by construction — one action at a time, and a gate is armed only
  // before one starts.
  readonly property string statusText: {
    if (root.actionState.phase === "failed")
      return (root.actionState.label || "That") + " — " + root.actionState.message;
    if (root.confirmKey !== "")
      return root.confirmLabel + "? Press again to confirm.";
    if (root.actionState.phase === "running")
      return (root.actionState.label || "Working") + "\u2026";
    if (root.actionState.phase === "done")
      return root.actionState.done || "";
    return "";
  }

  readonly property string statusLevel: {
    if (root.actionState.phase === "failed")
      return "down";
    if (root.confirmKey !== "")
      return "warn";
    // Emerald, the same dot a running service draws — a confirmation that
    // matched the failure's red would read as another problem.
    return root.actionState.phase === "done" ? "ok" : "info";
  }

  // The armed gate in words. Rebuilt from the snapshot rather than remembered,
  // so a service that disappeared under an armed button leaves nothing behind
  // to confirm.
  readonly property string confirmLabel: {
    if (root.confirmKey === "")
      return "";

    var rows = root.summary.services ? root.summary.services.rows : [];
    var actions = Actions.serviceActions();
    for (var i = 0; i < rows.length; i++) {
      var ref = Actions.serviceRef(rows[i]);
      for (var j = 0; j < actions.length; j++) {
        if (Actions.confirmToken(ref, actions[j].key) === root.confirmKey)
          return Actions.serviceActionLabel(actions[j].key, rows[i].display || ref);
      }
    }

    // The same sweep over the Environment rows. Searched second because a
    // service stop is the common case, and the two token namespaces cannot
    // collide — `svc:` and `env:` — so the order is only about cost.
    var envs = Model.envRows(root.summary);
    var envActions = Actions.envActions();
    for (var m = 0; m < envs.length; m++) {
      var target = Actions.envTarget(envs[m]);
      if (!target)
        continue;
      for (var n = 0; n < envActions.length; n++) {
        if (Actions.envToken(target, envActions[n].key) === root.confirmKey)
          return Actions.envActionLabel(envActions[n].key, Actions.envDisplay(root.summary, envs[m]));
      }
    }
    return "";
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
    root.disarm();
  }

  // Every keystroke re-ranks the list, so the row the cursor was on is not the
  // row it would be on now. Dropping it is the honest answer, and it puts
  // Enter back on the top match — which is what someone still typing means.
  onQueryChanged: {
    root.clearCursor();
    // A query that re-ranks the list has moved the button the gate was armed
    // on. Holding the arm across that would be holding it over whatever row
    // has since taken that place.
    root.disarm();
  }

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
    // Escape undoes the smallest thing first, and an armed gate is the
    // smallest: it is the one state on screen that is *asking* a question.
    if (root.confirmKey !== "") {
      root.disarm();
    } else if (root.cursorKey !== "" || root.query !== "") {
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
  // The same for the services that were never set up. Not a cursor stop —
  // there is nothing runnable behind it — so this one is only ever toggled by
  // a click. See ServicesSection.


  // The panel's draw order and the cursor's map, from the same three calls.
  readonly property var siteList: Model.visibleSites(root.summary, root.search, root.sitesExpanded)
  readonly property var serviceList: Model.visibleServices(root.summary, root.search)
  // The Environment rows, owned here for the same reason the two lists are:
  // the section draws them and the cursor walks them, and two files cannot both
  // be the authority on what is on screen.
  //
  // Now the third searchable list rather than a section that hid under a query.
  // `Model.visibleEnv` narrows it to the toggleable rows that matched, so typing
  // "caddy" reaches the button the same way typing a site name reaches its row.
  readonly property var envList: Model.visibleEnv(root.summary, root.search)

  readonly property var nav: Actions.navRows(root.summary, root.siteList, root.serviceList, root.envList)

  function moveCursor(dx, dy) {
    // Moving off an armed button cancels it. A gate is a question about the
    // thing under the cursor, and the cursor has just stopped being there.
    root.disarm();
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
    else if (target.kind === "service")
      root.runServiceAction(target.service, target.action);
    else if (target.kind === "env")
      root.runEnvAction(target.env, target.action);
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
    // Through the widget's argv route, not `bar.run()`: the host's helper takes
    // a *command string* and hands it to a shell, and a plugin that reaches for
    // a shell for a fixed program has no reason to. `runDetached` passes argv.
    if (root.hostWidget && typeof root.hostWidget.runDetached === "function")
      root.hostWidget.runDetached(["/usr/bin/hubdev"]);
    root.close();
  }

  // Whether the footer's second button is an update or the usual refresh.
  //
  // Asked of `Actions.updateArgv` rather than of `summary.outdated`, even
  // though the flag is right there, so that the button can never appear in a
  // state the click would then refuse. One gate, one answer, and node holds it.
  readonly property bool canUpdate: Actions.updateArgv(root.summary).length > 0

  // Update HubDev — the footer action that replaces Refresh when the CLI is too
  // old to answer `snapshot --json` at all.
  //
  // Refresh is the wrong offer in that state and always was: it re-asks a
  // question whose answer cannot change, so the panel spends its one visible
  // action telling the user again what it just told them. This is the action
  // that ends the state instead.
  //
  // It opens a terminal rather than running anything here. Actions.js carries
  // the full reasoning; the short version is that the update escalates, takes
  // minutes, replaces the binary this widget polls, and on Arch moves more than
  // HubDev alone — so it needs somewhere visible and interruptible to happen,
  // and this panel is neither.
  //
  // Closing afterwards is the same rule as openSite and the row actions: a
  // terminal window is about to take the screen, and a popout left hanging
  // behind it reads as a click that did not land.
  function updateHubDev() {
    var argv = Actions.updateArgv(root.summary);
    if (!argv.length)
      return;
    if (root.hostWidget && typeof root.hostWidget.runDetached === "function")
      root.hostWidget.runDetached(argv);
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
              item.services = Qt.binding(function () { return root.serviceList; });
              item.envRows = Qt.binding(function () { return root.envList; });
              item.actionState = Qt.binding(function () { return root.actionState; });
              item.confirmKey = Qt.binding(function () { return root.confirmKey; });
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

        // What an action is doing, asking or refusing — in the FOOTER, and the
        // placement is the decision, not the wording.
        //
        // A line that appears above the list pushes every row down by its own
        // height, which for a confirm gate means the button you are about to
        // press for the second time moves out from under the pointer. The body
        // is anchored between the search box and this column, so a line here
        // grows the panel downwards (or shrinks the scroll area, when the panel
        // is already at its cap) and the rows do not move at all.
        Row {
          width: parent.width
          visible: root.statusText !== ""
          spacing: Style.space(6)

          StatusDot {
            anchors.verticalCenter: parent.verticalCenter
            level: root.statusLevel
            size: Style.space(6)
          }

          Text {
            width: parent.width - Style.space(6) * 2
            anchors.verticalCenter: parent.verticalCenter
            text: root.statusText
            textFormat: Text.PlainText
            wrapMode: Text.WordWrap
            maximumLineCount: 2
            elide: Text.ElideRight
            color: root.barForeground
            opacity: 0.85
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }
        }

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

          // Refresh, unless refreshing is the one thing that cannot help —
          // see `canUpdate`. The button is one button in both states rather
          // than two that take turns being visible: the footer keeps its two
          // equal halves, and nothing under the pointer moves when a poll
          // changes the answer.
          Button {
            width: (parent.width - parent.spacing) / 2
            text: root.canUpdate ? "Update HubDev" : "Refresh"
            iconText: Theme.icon(root.canUpdate ? "update" : "refresh")
            bordered: true
            foreground: root.barForeground
            fontFamily: root.fontFamily
            fontSize: Style.font.bodySmall
            onClicked: {
              if (root.canUpdate)
                root.updateHubDev();
              else
                root.refresh();
            }
          }
        }
      }
    }
  }
}
