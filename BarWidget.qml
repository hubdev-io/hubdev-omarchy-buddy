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
  readonly property bool panelOpen: panelLoader.item ? panelLoader.item.opened === true : false

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

  function open() {
    if (panelLoader.item)
      panelLoader.item.open();
  }

  function close() {
    if (panelLoader.item)
      panelLoader.item.close();
  }

  function toggle() {
    if (panelLoader.item)
      panelLoader.item.toggle();
  }

  // Open a URL in whatever the desktop calls its browser. The one write this
  // widget performs, and it is deliberately the cheapest possible shape:
  //
  //  - `omarchy-launch-browser` resolves the default through xdg-settings, so
  //    "my browser" means what it means everywhere else on this desktop.
  //  - `Util.execArgv` hands bash a fixed argv as positional parameters, which
  //    are expanded without re-tokenising — a domain can never become a
  //    command, whatever HubDev's config contains (plan §6, R6).
  //  - It is detached. Nothing in the shell waits on a browser, so there is no
  //    Process to time out and nothing to hang the bar. The `snapshotProc`
  //    guard timer exists precisely because reads are *not* detached; this is
  //    the other half of that rule, not an exception to it.
  //
  // The URL is built and validated by Model.siteUrl, which node tests.
  function openUrl(url) {
    if (!url)
      return;
    Util.execArgv(["omarchy-launch-browser", url]);
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
      open: root.panelOpen,
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

    // The panel exists once per monitor, so these are broadcast too — summoning
    // it on one screen and leaving the other stale would be worse than not
    // having the route at all.
    function open(): void {
      root.broadcast("open");
    }

    function close(): void {
      root.broadcast("close");
    }

    function toggle(): void {
      root.broadcast("toggle");
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

    // Refresh first so the panel opens onto current numbers rather than
    // however old the last poll was, then toggle. The refresh is coalesced, so
    // a click during an in-flight poll is a no-op rather than a second spawn.
    onPressed: function (buttonCode) {
      if (buttonCode !== Qt.LeftButton)
        return;
      root.refresh("full");
      root.toggle();
    }
  }
}
