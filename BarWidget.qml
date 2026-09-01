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
  readonly property bool panelOpen: false   // Phase 3 binds this to the panel.

  QtObject {
    id: internal
    property var summary: Model.empty()
    property int consecutiveFailures: 0
    property bool inFlight: false
    property string pendingTier: "full"
    property double lastFullRefreshMs: 0
    property bool everSucceeded: false
  }

  // A summary older than two intervals is shown dimmed rather than replaced:
  // the last true numbers beat no numbers, as long as we say they are stale.
  readonly property bool stale: internal.consecutiveFailures > 0 && internal.everSucceeded

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
    internal.summary = Model.summarize(snapshot);
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
    poll.restart();
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
    triggeredOnStart: true
    // Suspended when the bar is not on screen: an invisible widget has no
    // reason to spawn a process twice a minute forever.
    running: root.visible
    onTriggered: root.refresh()
  }

  // Re-poll immediately when the bar comes back, so the first thing the user
  // sees after unhiding is current rather than however old the last poll was.
  onVisibleChanged: {
    if (visible)
      root.refresh();
  }

  IpcHandler {
    target: "io.hubdev.buddy"

    function refresh(): void {
      root.broadcast("refresh");
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

    // Phase 3 replaces this with the panel. Until then a click is a manual
    // refresh — read-only, which is all v0.1 claims to be.
    onPressed: root.refresh("full")
  }
}
