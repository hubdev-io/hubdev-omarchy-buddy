import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Actions.js" as Actions
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

  // The one action in flight, or the one that just refused. Read by the panel
  // and by every service row: `subject` is the service name, so a row can ask
  // "is that me?" without the panel having to route anything to it.
  //
  //   phase  "idle" | "running" | "done" | "failed"
  //
  // `done` says so in one line at the foot of the panel — "Redis restarted" —
  // and clears itself after three seconds. It was left out of the first cut on
  // the argument that the dot going green already says it; using the thing
  // proved otherwise, because the dot you are waiting on is one of eight in a
  // list, and the thing you are looking at is the button you just pressed.
  readonly property var actionState: internal.actionState

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
    property var actionState: ({ key: "", subject: "", label: "", done: "", phase: "idle", message: "" })
    // Accumulators for the two Processes. See the SplitParser comment below for
    // why the output is assembled here rather than by a StdioCollector.
    property string snapshotOut: ""
    property string actionOut: ""
    property bool snapshotOverflow: false
    property bool actionOverflow: false
  }

  // The ceiling on anything a child process may hand this widget.
  //
  // A full snapshot of a busy machine measured ~14 KB, so 1 MiB is two orders
  // of magnitude of headroom and still a bound. An action prints one line; 64
  // KiB is generous for that and small enough that a `hubdev` which decided to
  // stream would be cut off long before the shell felt it.
  readonly property int snapshotMaxBytes: 1048576
  readonly property int actionMaxBytes: 65536

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

  // ----------------------------------------------------------- run an action --
  //
  // The other half of `runDetached`, and everything about it follows from the
  // fact that this one is NOT detached.
  //
  // `service:start` changes the machine and then tells us whether it managed
  // to. So it gets a `Process` whose exit code is read, a guard timer that can
  // end it, a state object the panel binds a spinner and a refusal to, and a
  // burst of refreshes afterwards — because the exit code is only HubDev's
  // opinion and the snapshot is the answer.
  //
  // **One at a time, and the rule is here rather than in the view.** Two
  // `hubdev` processes writing service state concurrently is not something the
  // CLI promises to survive, and a second click while the first is running is
  // far more likely to be impatience than intent. Every button dims while one
  // is in flight, and this refuses anyway: a guard that only exists in the UI
  // is a guard that a keyboard shortcut can walk around.
  //
  // The argv is built and validated in `Actions.serviceArgv`, which node tests.
  // This function checks it was handed something and nothing more — the same
  // division `runDetached` already has.
  function runAction(request) {
    var req = request && typeof request === "object" ? request : {};
    if (!req.argv || !req.argv.length)
      return false;
    if (internal.actionState.phase === "running")
      return false;

    internal.actionState = {
      key: req.key || "",
      subject: req.subject || "",
      label: req.label || "",
      // What to say once it worked. Passed in rather than derived, because the
      // wording is Actions.js's business and this file is not allowed to have
      // any of its own.
      done: req.doneLabel || "",
      phase: "running",
      message: ""
    };
    clearDone.stop();
    clearFailure.stop();
    internal.actionOut = "";
    internal.actionOverflow = false;

    actionProc.command = req.argv;
    actionGuard.interval = req.timeoutMs > 0 ? req.timeoutMs : 60000;
    actionGuard.restart();
    actionProc.running = true;
    return true;
  }

  // Where every ending arrives: exit code, timeout, or a spawn that never
  // happened. Success is held briefly and said in words at the foot of the
  // panel; a failure is held for six seconds so it can be read, and then
  // clears itself rather than waiting to be dismissed — a stale error in a
  // panel that reopens on a keybind would otherwise be the first thing the
  // next summon shows.
  function finishAction(ok, message) {
    if (ok) {
      internal.actionState = Object.assign({}, internal.actionState, {
        phase: "done",
        message: ""
      });
      clearDone.restart();
    } else {
      internal.actionState = Object.assign({}, internal.actionState, {
        phase: "failed",
        message: message || "It did not work, and HubDev did not say why"
      });
      clearFailure.restart();
    }
    root.burstRefresh();
  }

  // A container reports itself running before HubDev's own probe agrees, and a
  // stop takes as long as the graceful timeout it was given. One refresh on
  // completion would therefore show the state the action was trying to leave,
  // which reads exactly like a button that did nothing.
  //
  // So: refresh now, then three more times over the next four seconds. Each
  // tick is coalesced against the polling loop like any other refresh, and a
  // tick dropped for one already in flight is simply picked up by the next —
  // which is the reason this is a repeating timer with a counter rather than
  // three scheduled callbacks.
  function burstRefresh() {
    root.refresh("full");
    burst.left = 3;
    burst.restart();
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
    internal.snapshotOut = "";
    internal.snapshotOverflow = false;
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

  // `code` is the refusal in a form the panel can branch on, and it is carried
  // down BOTH paths on purpose. A HubDev that answered fine yesterday and is
  // too old today — a downgrade, a package rollback — keeps its last good
  // summary on screen, and the footer should still offer the update that would
  // fix it. Dropping the code on the stale path would make the offer depend on
  // whether this widget had ever seen a good snapshot, which is not a fact
  // about HubDev.
  function fail(reason, code) {
    internal.consecutiveFailures += 1;
    // Keep the last good summary on screen (dimmed) rather than blanking the
    // bar on one dropped poll. Only give up on it if we never had one.
    if (!internal.everSucceeded)
      internal.summary = Model.unreachable(reason, code);
    else
      internal.summary = Object.assign({}, internal.summary, {
        staleReason: reason,
        outdated: code === "outdated"
      });
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
    command: ["/usr/bin/hubdev", "snapshot", "--json"]   // replaced per-request

    // Not a StdioCollector, and the difference is the whole point.
    //
    // `StdioCollector` retains the child's complete stdout before anything can
    // look at its length, so a `hubdev` that streamed — a bug, a runaway Docker
    // label, a future subcommand — would allocate without bound *inside the
    // shell process that draws the whole desktop*. A cap checked after the
    // bytes are in memory is a cap applied too late.
    //
    // `SplitParser` with an empty marker delivers raw chunks instead, so the
    // budget is enforced while the child is still running: over the ceiling,
    // the buffer is dropped, the child is TERMed, and killTimer escalates to
    // KILL if it does not go. The read is failed rather than truncated —
    // half a JSON document is not a smaller snapshot, it is a wrong one.
    stdout: SplitParser {
      splitMarker: ""
      onRead: function (chunk) {
        if (internal.snapshotOverflow)
          return;
        internal.snapshotOut += chunk;
        if (internal.snapshotOut.length > root.snapshotMaxBytes) {
          internal.snapshotOverflow = true;
          internal.snapshotOut = "";
          snapshotProc.signal(15);
          snapshotKill.restart();
        }
      }
    }

    onExited: function (exitCode) {
      guard.stop();
      snapshotKill.stop();
      internal.inFlight = false;
      var out = internal.snapshotOut;
      var overflowed = internal.snapshotOverflow;
      internal.snapshotOut = "";
      internal.snapshotOverflow = false;
      if (overflowed) {
        root.fail("HubDev returned more output than this widget will read");
        return;
      }
      var result = Source.parse(out, exitCode);
      if (result.ok)
        root.succeed(result.snapshot);
      else
        root.fail(result.error, result.code);
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
      if (snapshotProc.running) {
        snapshotProc.running = false;   // terminates the child
        snapshotKill.restart();         // …and kills it if it ignores that
      }
      internal.inFlight = false;
      internal.snapshotOut = "";
      internal.snapshotOverflow = false;
      root.fail("HubDev did not answer in time");
    }
  }

  // The action's own Process, kept separate from the snapshot's on purpose.
  // They have different timeouts, different failure wording and different
  // lifetimes, and sharing one would mean a refresh landing mid-action could
  // reassign `command` under a running child.
  Process {
    id: actionProc
    command: ["/usr/bin/hubdev", "service:list"]   // replaced per-request

    // Same budget rule as the snapshot process, smaller ceiling — see there.
    stdout: SplitParser {
      splitMarker: ""
      onRead: function (chunk) {
        if (internal.actionOverflow)
          return;
        internal.actionOut += chunk;
        if (internal.actionOut.length > root.actionMaxBytes) {
          internal.actionOverflow = true;
          internal.actionOut = "";
          actionProc.signal(15);
          actionKill.restart();
        }
      }
    }

    onExited: function (exitCode) {
      actionGuard.stop();
      actionKill.stop();
      var out = internal.actionOut;
      var overflowed = internal.actionOverflow;
      internal.actionOut = "";
      internal.actionOverflow = false;
      if (overflowed) {
        root.finishAction(false, "HubDev returned more output than this widget will read");
        return;
      }
      // HubDev prints the reason on STDOUT, not stderr, and colours it with
      // ANSI unconditionally — Actions.parseResult is where both facts live.
      var result = Actions.parseResult(out, exitCode);
      root.finishAction(result.ok, result.message);
    }
  }

  // The guard the plan makes mandatory (§5.4, §7.1). Service verbs reach root
  // through `sudo -n`, which never prompts — but only while HubDev's sudoers
  // rule is installed. Without it the fallback is `pkexec`, and a polkit dialog
  // would hold this child open until somebody noticed it. The ceiling is per
  // verb (Actions.timeoutMs) because a container start and a container stop are
  // not the same wait.
  Timer {
    id: actionGuard
    repeat: false
    onTriggered: {
      if (actionProc.running) {
        actionProc.running = false;   // terminates the child
        actionKill.restart();         // …and kills it if it ignores that
      }
      internal.actionOut = "";
      internal.actionOverflow = false;
      root.finishAction(false, (internal.actionState.label || "That") + " did not finish in time");
    }
  }

  // TERM is a request. These are the escalation halves of the two overflow
  // paths and of the guard timers: two seconds after the polite signal, the
  // child is killed. Without them a `hubdev` ignoring SIGTERM would keep
  // writing into a pipe nobody reads.
  Timer {
    id: snapshotKill
    interval: 2000
    repeat: false
    onTriggered: if (snapshotProc.running) snapshotProc.signal(9)
  }

  Timer {
    id: actionKill
    interval: 2000
    repeat: false
    onTriggered: if (actionProc.running) actionProc.signal(9)
  }

  Timer {
    id: clearDone
    // Shorter than the failure's six seconds on purpose: a confirmation is read
    // at a glance and a refusal is read twice.
    interval: 3000
    repeat: false
    onTriggered: {
      if (internal.actionState.phase === "done")
        internal.actionState = { key: "", subject: "", label: "", done: "", phase: "idle", message: "" };
    }
  }

  Timer {
    id: clearFailure
    interval: 6000
    repeat: false
    onTriggered: {
      if (internal.actionState.phase === "failed")
        internal.actionState = { key: "", subject: "", label: "", done: "", phase: "idle", message: "" };
    }
  }

  Timer {
    id: burst
    interval: 1400
    repeat: true
    property int left: 0
    onTriggered: {
      root.refresh("full");
      burst.left -= 1;
      if (burst.left <= 0)
        burst.stop();
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

  // A widget can be destroyed while a child is still running — the bar slot is
  // rebuilt on a layout change, the plugin is disabled, the shell restarts.
  // Neither Process is detached, so ending them here is what keeps "this plugin
  // leaves nothing behind" true rather than merely likely.
  Component.onDestruction: {
    if (snapshotProc.running)
      snapshotProc.signal(15);
    if (actionProc.running)
      actionProc.signal(15);
  }
}
