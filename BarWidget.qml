import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model
import "Theme.js" as Theme
// THE TRANSPORT SEAM. Phase 6 swaps this one line for "SourceHttp.js" and
// nothing else in the plugin changes.
import "SourceJson.js" as Source

// The only file in this plugin that does I/O.
//
// Everything else — Model.js, Theme.js, SourceJson.js — is pure JavaScript that
// `node --test` runs directly. That is the whole architecture: if a rule is
// worth getting right, it does not live in this file.
BarWidget {
  id: root
  moduleName: "io.hubdev.buddy"

  // ---------------------------------------------------------------- state --
  readonly property var summary: internal.summary
  readonly property string level: internal.summary.level

  // SHAPE CONTRACT. `Bar.findPanelWidget` and `Bar.panelNavigationSlots` both
  // skip any slot whose activeItem is missing `open()`, `close()` or `opened`
  // — and it is the *widget root* they look at, not the panel. This property
  // was called `panelOpen` until Phase 4d, which quietly cost four things:
  //
  //   - `omarchy-shell shell toggle io.hubdev.buddy` answered "unknown", so
  //     there was no way to bind the panel to a key at all;
  //   - Buddy was left out of the SUPER+CTRL+<n> panel numbering, which does
  //     not leave a gap — it renumbers every panel to its right;
  //   - the Tab key, wired to `bar.switchPanelFrom` since Phase 3, could never
  //     find its own slot and so did nothing;
  //   - and nothing reported any of it, because the contract is a name.
  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false

  // Forwarded for the same reason. `Bar.requestPopout` prefers
  // `closeForPopoutSwitch` over `close`, and KeyboardPanel reads
  // `popoutSwitchClosing` back off its *owner* — which Panel.qml sets to this
  // widget (`owner: root.hostWidget`), not to itself.
  readonly property bool popoutSwitchClosing: panelLoader.item
    ? panelLoader.item.popoutSwitchClosing === true : false

  QtObject {
    id: internal
    property var summary: Model.empty()
    property int consecutiveFailures: 0
    property bool inFlight: false
    property string pendingTier: "full"
    property double lastFullRefreshMs: 0
    property bool everSucceeded: false
    // The last snapshot document, already merged. Kept because a cheap-tier
    // reply is partial and has to be laid over something.
    property var lastSnapshot: ({})
  }

  // A summary older than two intervals is shown dimmed rather than replaced:
  // the last true numbers beat no numbers, as long as we say they are stale.
  readonly property bool stale: internal.consecutiveFailures > 0 && internal.everSucceeded

  // ----------------------------------------------------------------- panel --

  // Refresh before showing anything, so the panel opens onto current numbers
  // rather than however old the last poll was. It lives here rather than in the
  // click handler because clicking the mark is no longer the only way in: a
  // keybind is, and that is the entry point that most wants fresh numbers,
  // since summoning the panel from another workspace is how you go and check on
  // something. Coalesced, so a summon during an in-flight poll is a no-op
  // rather than a second spawn.
  function open() {
    if (!panelLoader.item)
      return;
    root.refresh("full");
    panelLoader.item.open();
  }

  function close() {
    if (panelLoader.item)
      panelLoader.item.close();
  }

  function toggle() {
    if (root.opened)
      root.close();
    else
      root.open();
  }

  // Run one of open/close/toggle on the single instance the shell would pick:
  // the widget on the output Hyprland has focused. `summonBarWidget` and its
  // pair resolve that through `Bar.pickPanelSlot`, which is exactly what
  // `omarchy-shell shell toggle <id>` goes through — so a keybind and this
  // route cannot disagree about which screen the panel belongs on.
  //
  // Note what that means when the panel is already open on the *other* head:
  // pickPanelSlot prefers an open instance over the focused one, so the first
  // press closes the stray and the second opens it here. That is what every
  // first-party panel does with SUPER+CTRL+<letter>, and matching them is worth
  // more than being cleverer than them.
  function runOnFocused(verb) {
    var host = root.bar;
    if (host && typeof host.summonBarWidget === "function") {
      if (verb === "close" || (verb === "toggle" && host.isBarWidgetOpen(root.moduleName)))
        host.hideBarWidget(root.moduleName);
      else
        host.summonBarWidget(root.moduleName);
      return;
    }
    // No bar host to route through yet. Acting on this instance is at least a
    // real answer; doing nothing would make the route look broken.
    if (verb === "open")
      root.open();
    else if (verb === "close")
      root.close();
    else
      root.toggle();
  }

  // The one write this widget performs, and it is deliberately the cheapest
  // possible shape:
  //
  //  - `Util.execArgv` hands bash a fixed argv as positional parameters, which
  //    are expanded without re-tokenising — a domain or a site name can never
  //    become a command, whatever HubDev's config contains (plan §6, R6).
  //  - It is detached. Nothing in the shell waits on a browser, a terminal or
  //    an editor, so there is no Process to time out and nothing to hang the
  //    bar. The `snapshotProc` guard timer exists precisely because reads are
  //    *not* detached; this is the other half of that rule, not an exception.
  //
  // Which is exactly why only these verbs go through here. Anything whose
  // output or exit code matters needs a Process and a guard timer, and calling
  // it "detached" would just mean losing the failure.
  //
  // The argv itself is always built and validated somewhere node can test it —
  // Model.siteUrl for the URL, Actions.siteArgv for the row actions. This
  // function checks that it was handed something, and nothing more.
  function runDetached(argv) {
    if (!argv || !argv.length)
      return;
    Util.execArgv(argv);
  }

  // Open a URL in whatever the desktop calls its browser. `omarchy-launch-browser`
  // resolves the default through xdg-settings, so "my browser" means what it
  // means everywhere else on this desktop — the same reasoning that lets the
  // row actions defer to $TERMINAL, xdg-open and `hubdev editor:use`.
  function openUrl(url) {
    if (!url)
      return;
    root.runDetached(["omarchy-launch-browser", url]);
  }

  function closeForPopoutSwitch() {
    if (panelLoader.item)
      panelLoader.item.closeForPopoutSwitch();
  }

  // The panel is a separate QML item with no access to the bar host, so the
  // three things it needs are pushed in. `summary` is bound rather than
  // assigned: it changes on every poll, and an assignment would freeze the
  // panel on whatever was true when it opened.
  function injectPanel() {
    if (!panelLoader.item)
      return;
    panelLoader.item.bar = root.bar;
    panelLoader.item.anchorItem = button;
    panelLoader.item.hostWidget = root;
    panelLoader.item.settings = root.settings;
    panelLoader.item.summary = Qt.binding(function () { return root.summary; });
  }

  onBarChanged: root.injectPanel()
  onSettingsChanged: root.injectPanel()

  Loader {
    id: panelLoader
    active: true
    visible: false
    source: Qt.resolvedUrl("Panel.qml")
    onLoaded: {
      root.injectPanel();
      // `bar` is injected by the host after this widget is constructed, so the
      // first pass can run before it exists. Re-running on the next tick is
      // what lerd Glance does, and it is the difference between a panel that
      // themes correctly and one that opens with default colours.
      Qt.callLater(root.injectPanel);
    }
  }

  // --------------------------------------------------------------- polling --

  function msNow() {
    return new Date().getTime();
  }

  function pollState() {
    return {
      open: root.opened,
      consecutiveFailures: internal.consecutiveFailures,
      msSinceFullRefresh: root.msNow() - internal.lastFullRefreshMs
    };
  }

  // Coalesced: never two snapshots in flight. A slow `hubdev` under Docker load
  // (568ms for services alone — plan §7.2) must not stack up a queue of spawns.
  function refresh(tierOverride) {
    if (internal.inFlight)
      return;
    var tier = tierOverride || Source.tierFor(root.pollState());
    var req = Source.request(tier);
    if (req.kind !== "process") {
      // A future adapter that is not process-based needs its own branch here.
      // Failing loudly beats silently never refreshing.
      root.fail("This build cannot use the configured HubDev source");
      return;
    }
    internal.pendingTier = req.tier;
    internal.inFlight = true;
    snapshotProc.command = req.argv;
    guard.interval = Source.timeoutMs(req.tier);
    guard.restart();
    snapshotProc.running = true;
  }

  function succeed(snapshot) {
    internal.consecutiveFailures = 0;
    internal.everSucceeded = true;
    if (internal.pendingTier === "full")
      internal.lastFullRefreshMs = root.msNow();
    // A cheap-tier reply omits whole sections rather than emptying them, so it
    // is merged over the last document instead of replacing it — otherwise
    // every 5s poll with the panel open would blank "Services 5/8" to
    // "Services 0/0" until the next full read. Model.merge explains the rule.
    internal.lastSnapshot = Model.merge(internal.lastSnapshot, snapshot);
    internal.summary = Model.summarize(internal.lastSnapshot);
    root.reschedule();
  }

  function fail(reason) {
    internal.consecutiveFailures += 1;
    // Keep the last good summary on screen (dimmed) rather than blanking the
    // bar on one dropped poll. Only give up on it if we never had one.
    if (!internal.everSucceeded)
      internal.summary = Model.unreachable(reason);
    else
      internal.summary = Object.assign({}, internal.summary, { staleReason: reason });
    root.reschedule();
  }

  function reschedule() {
    poll.interval = Source.intervalFor(root.pollState());
    // stop()/start() rather than restart(): see the Timer below for why the
    // difference is the whole ballgame. Visibility is re-asserted here because
    // assigning `running` imperatively would break a binding on it anyway.
    poll.stop();
    if (root.visible)
      poll.start();
  }

  // ------------------------------------------------------------------ I/O --

  Process {
    id: snapshotProc
    command: ["hubdev", "snapshot", "--json"]   // replaced per-request

    stdout: StdioCollector {
      waitForEnd: true
    }

    onExited: function (exitCode) {
      guard.stop();
      internal.inFlight = false;
      var result = Source.parse(stdout.text, exitCode);
      if (result.ok)
        root.succeed(result.snapshot);
      else
        root.fail(result.error);
    }
  }

  // Every Process gets a hard timeout. Reads never escalate, but a verb that
  // did would fall back to `pkexec` and block on a polkit dialog (plan §7.1);
  // the timeout is what keeps "reads never hang the shell" true by
  // construction rather than by trust.
  Timer {
    id: guard
    repeat: false
    onTriggered: {
      if (snapshotProc.running)
        snapshotProc.running = false;   // terminates the child
      internal.inFlight = false;
      root.fail("HubDev did not answer in time");
    }
  }

  Timer {
    id: poll
    interval: 30000
    repeat: true
    // Deliberately NOT `triggeredOnStart`, and deliberately not `running:
    // root.visible`.
    //
    // A Timer with triggeredOnStart fires the moment it is started — and
    // reschedule() starts it after every completed poll. That turned "poll,
    // then wait 30 seconds" into "poll, then poll again immediately", a loop
    // bounded only by how long `hubdev snapshot` takes. Observed live: two
    // full snapshots in flight continuously, a new process every second,
    // Docker probed and `doctor` run without pause. It was invisible for the
    // whole of Phase 2 because against a HubDev with no `snapshot` verb every
    // spawn failed in milliseconds and cost nothing worth noticing.
    //
    // The first poll is kicked off explicitly below instead, and visibility
    // is handled in one place rather than by a binding that the first
    // imperative start() would silently destroy.
    onTriggered: root.refresh()
  }

  // The bar coming back on screen re-polls at once, so the first thing the
  // user sees is current rather than however old the last poll was. Going
  // away stops the loop: an invisible widget has no reason to spawn a process
  // twice a minute forever.
  onVisibleChanged: {
    if (root.visible)
      root.refresh();
    else
      poll.stop();
  }

  Component.onCompleted: {
    if (root.visible)
      root.refresh();
  }

  IpcHandler {
    target: "io.hubdev.buddy"

    function refresh(): void {
      root.broadcast("refresh");
    }

    // Summoning goes to exactly one instance, and broadcasting was wrong for
    // it: on two monitors the old route opened the panel on both heads, which
    // is not an answer to "show me this" — you can only look at one of them.
    // Refresh above stays broadcast for the opposite reason: every bar shows
    // the mark, so leaving one head on older numbers than it has is a real
    // difference the user can see.
    function open(): void {
      root.runOnFocused("open");
    }

    function close(): void {
      root.runOnFocused("close");
    }

    function toggle(): void {
      root.runOnFocused("toggle");
    }
  }

  // ----------------------------------------------------------------- view --

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    slotSize: Style.bar.statusSlot
    tooltipText: root.stale && internal.summary.staleReason
      ? Model.tooltip(internal.summary) + "\n\n(" + internal.summary.staleReason + ")"
      : Model.tooltip(internal.summary)

    iconComponent: Component {
      Mark {
        level: root.level
        foreground: button.foreground
        glyphSize: Style.font.caption
        stale: root.stale
      }
    }

    // Deliberately this instance's toggle rather than the focused-output route:
    // a click has already said which screen it means. The refresh that used to
    // sit here moved into open(), so every way in gets it.
    onPressed: function (buttonCode) {
      if (buttonCode !== Qt.LeftButton)
        return;
      root.toggle();
    }
  }
}
