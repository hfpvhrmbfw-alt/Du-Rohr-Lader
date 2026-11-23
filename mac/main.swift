// Mac-Hülle für den DU-Rohr-Lader: startet den mitgelieferten Node-Server im Hintergrund und zeigt die
// vorhandene Oberfläche (web/) in einem eigenen Fenster. Kein Teil des Kerns: Logik, Daten und Oberfläche
// bleiben im Server und in web/, hier liegen nur Fenster, Menüs und der Prozess-Start.
//
// Paketinhalt (siehe mac/build.sh):
//   Contents/Resources/app/   server/, src/, web/, package.json
//   Contents/Resources/bin/   node, yt-dlp, ffmpeg, ffprobe, yt-dlp.version
//
// yt-dlp wird beim ersten Start in den Datenordner kopiert (bin/yt-dlp), damit „yt-dlp aktualisieren“
// die Kopie ersetzen kann, ohne die signierte App zu verändern.

import Cocoa
import WebKit

let appName = "DU-Rohr-Lader"
let port = 8787
let baseURL = URL(string: "http://127.0.0.1:\(port)/")!

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
  var window: NSWindow!
  var webView: WKWebView!
  var statusItem: NSStatusItem!
  var lanItem: NSMenuItem!
  var updateItem: NSMenuItem!
  var server: Process?
  var serverIsOurs = false
  var restarting = false
  var quitting = false

  let fm = FileManager.default
  var res: URL { Bundle.main.resourceURL! }
  var bundledBin: URL { res.appendingPathComponent("bin") }
  var dataDir: URL { fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("YouTube-Downloader") }
  var userBin: URL { dataDir.appendingPathComponent("bin") }
  var ytdlp: URL { userBin.appendingPathComponent("yt-dlp") }
  var logFile: URL { dataDir.appendingPathComponent("app.log") }

  var lanOn: Bool {
    get { UserDefaults.standard.bool(forKey: "lan") }
    set { UserDefaults.standard.set(newValue, forKey: "lan") }
  }

  // MARK: Start und Ende

  func applicationDidFinishLaunching(_ note: Notification) {
    buildMainMenu()
    buildStatusItem()
    buildWindow()
    prepareYtDlp()
    startServer()
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool {
    // Fenster zu heißt nicht Ende: laufende Downloads und das iPhone brauchen den Server weiter.
    false
  }

  func applicationShouldHandleReopen(_ app: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    showWindow()
    return true
  }

  func applicationWillTerminate(_ note: Notification) {
    quitting = true
    stopServer(wait: true)
  }

  // MARK: yt-dlp im Datenordner

  func readVersion(_ url: URL) -> String {
    ((try? String(contentsOf: url, encoding: .utf8)) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  }

  /// Kopiert das mitgelieferte yt-dlp in den Datenordner, wenn dort keines liegt oder die mitgelieferte
  /// Version neuer ist (z. B. nach einem App-Update). yt-dlp-Versionen sind Daten (2026.08.19) und lassen
  /// sich als Text vergleichen.
  func prepareYtDlp() {
    let bundled = bundledBin.appendingPathComponent("yt-dlp")
    let bundledVersion = readVersion(bundledBin.appendingPathComponent("yt-dlp.version"))
    let copyVersion = readVersion(userBin.appendingPathComponent("yt-dlp.version"))
    guard !fm.fileExists(atPath: ytdlp.path) || bundledVersion > copyVersion else { return }
    do {
      try fm.createDirectory(at: userBin, withIntermediateDirectories: true)
      if fm.fileExists(atPath: ytdlp.path) { try fm.removeItem(at: ytdlp) }
      try fm.copyItem(at: bundled, to: ytdlp)
      try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: ytdlp.path)
      try bundledVersion.write(to: userBin.appendingPathComponent("yt-dlp.version"), atomically: true, encoding: .utf8)
    } catch {
      NSLog("yt-dlp kopieren fehlgeschlagen: \(error)")
    }
  }

  var ytdlpPath: String {
    fm.isExecutableFile(atPath: ytdlp.path) ? ytdlp.path : bundledBin.appendingPathComponent("yt-dlp").path
  }

  // MARK: Server

  func ping(_ done: @escaping (Bool) -> Void) {
    var req = URLRequest(url: baseURL.appendingPathComponent("api/status"))
    req.timeoutInterval = 1
    URLSession.shared.dataTask(with: req) { _, resp, _ in
      let ok = (resp as? HTTPURLResponse)?.statusCode == 200
      DispatchQueue.main.async { done(ok) }
    }.resume()
  }

  func startServer() {
    showMessage("Startet …", "")
    ping { running in
      if running {
        // Läuft schon (z. B. über Starten.command): mitbenutzen, nicht zweimal starten.
        self.serverIsOurs = false
        self.loadApp()
      } else {
        self.launchServer()
      }
    }
  }

  func launchServer() {
    try? fm.createDirectory(at: dataDir, withIntermediateDirectories: true)
    let p = Process()
    p.executableURL = bundledBin.appendingPathComponent("node")
    p.arguments = [res.appendingPathComponent("app/server/main.js").path]
    p.currentDirectoryURL = res.appendingPathComponent("app")
    var env = ProcessInfo.processInfo.environment
    env["PATH"] = [userBin.path, bundledBin.path, "/usr/bin", "/bin", "/usr/sbin", "/sbin", "/opt/homebrew/bin", "/usr/local/bin"].joined(separator: ":")
    env["PORT"] = String(port)
    env["YTDLP_BIN"] = ytdlpPath
    env["FFMPEG_BIN"] = bundledBin.appendingPathComponent("ffmpeg").path
    env["YTD_APP"] = "1"
    env["YTD_PARENT_PID"] = String(ProcessInfo.processInfo.processIdentifier)
    if lanOn { env["YTD_LAN"] = "1" } else { env.removeValue(forKey: "YTD_LAN") }
    p.environment = env
    if !fm.fileExists(atPath: logFile.path) { fm.createFile(atPath: logFile.path, contents: nil) }
    if let log = try? FileHandle(forWritingTo: logFile) {
      log.truncateFile(atOffset: 0)
      p.standardOutput = log
      p.standardError = log
    }
    p.terminationHandler = { [weak self] proc in
      DispatchQueue.main.async { self?.serverEnded(proc) }
    }
    do {
      try p.run()
    } catch {
      showMessage("Server startet nicht", "Node.js im App-Paket ließ sich nicht ausführen: \(error.localizedDescription)")
      return
    }
    server = p
    serverIsOurs = true
    waitForServer(tries: 0)
  }

  func waitForServer(tries: Int) {
    ping { ok in
      if ok { return self.loadApp() }
      guard let p = self.server, p.isRunning else { return }
      if tries > 75 {
        self.showMessage("Server antwortet nicht", "Details stehen in \(self.logFile.path).")
        return
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { self.waitForServer(tries: tries + 1) }
    }
  }

  func serverEnded(_ proc: Process) {
    server = nil
    if quitting { return }
    if restarting {
      restarting = false
      return startServer()
    }
    showMessage("Server wurde beendet", "Code \(proc.terminationStatus). Vielleicht belegt ein anderes Programm Port \(port). Details stehen in \(logFile.path). Neu starten über das Symbol in der Menüleiste → Server neu starten.")
  }

  func stopServer(wait: Bool) {
    guard let p = server, p.isRunning else { return }
    p.terminate() // SIGTERM: der Server bricht laufende Downloads ab und beendet sich
    guard wait else { return }
    let deadline = Date().addingTimeInterval(3)
    while p.isRunning && Date() < deadline { usleep(50_000) }
    if p.isRunning { kill(p.processIdentifier, SIGKILL) }
  }

  @objc func restartServer() {
    guard serverIsOurs, let p = server, p.isRunning else {
      if serverIsOurs || server == nil { return startServer() }
      return alert("Läuft über Starten.command", "Der Server wurde nicht von dieser App gestartet. Bitte das Terminalfenster schließen und die App neu öffnen.")
    }
    restarting = true
    stopServer(wait: false)
  }

  // MARK: Fenster

  func buildWindow() {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default()
    webView = WKWebView(frame: .zero, configuration: config)
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.allowsBackForwardNavigationGestures = false

    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 820),
                      styleMask: [.titled, .closable, .miniaturizable, .resizable],
                      backing: .buffered, defer: false)
    window.title = appName
    window.minSize = NSSize(width: 420, height: 520)
    window.isReleasedWhenClosed = false
    window.delegate = self
    window.contentView = webView
    window.center()
    window.setFrameAutosaveName("Hauptfenster")
    window.makeKeyAndOrderFront(nil)
  }

  @objc func showWindow() {
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  func loadApp() {
    webView.load(URLRequest(url: baseURL))
  }

  @objc func reload() {
    if webView.url?.host == baseURL.host { webView.reload() } else { loadApp() }
  }

  func showMessage(_ title: String, _ text: String) {
    let esc = { (s: String) in s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;") }
    let html = """
    <!doctype html><meta charset="utf-8"><meta name="color-scheme" content="light dark">
    <style>body{font:15px -apple-system,sans-serif;margin:0;display:grid;place-items:center;height:100vh;background:#E4E6E7;color:#111}
    @media (prefers-color-scheme:dark){body{background:#1C1E20;color:#EEE}}
    div{max-width:520px;padding:24px;border-left:4px solid #E8451C}h1{font-size:20px;margin:0 0 8px}p{margin:0;opacity:.8}</style>
    <div><h1>\(esc(title))</h1><p>\(esc(text))</p></div>
    """
    webView.loadHTMLString(html, baseURL: nil)
  }

  // MARK: Menüs

  func buildMainMenu() {
    let main = NSMenu()

    let appMenu = NSMenu()
    appMenu.addItem(withTitle: "Über \(appName)", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "\(appName) ausblenden", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "\(appName) beenden", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    main.addItem(submenu(appName, appMenu))

    // Ohne dieses Menü gehen ⌘C, ⌘V und ⌘A im Fenster nicht.
    let edit = NSMenu(title: "Bearbeiten")
    edit.addItem(withTitle: "Widerrufen", action: Selector(("undo:")), keyEquivalent: "z")
    edit.addItem(withTitle: "Wiederholen", action: Selector(("redo:")), keyEquivalent: "Z")
    edit.addItem(.separator())
    edit.addItem(withTitle: "Ausschneiden", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    edit.addItem(withTitle: "Kopieren", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    edit.addItem(withTitle: "Einsetzen", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    edit.addItem(withTitle: "Alles auswählen", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    main.addItem(submenu("Bearbeiten", edit))

    let view = NSMenu(title: "Darstellung")
    view.addItem(withTitle: "Neu laden", action: #selector(reload), keyEquivalent: "r")
    view.addItem(withTitle: "Im Browser öffnen", action: #selector(openInBrowser), keyEquivalent: "")
    main.addItem(submenu("Darstellung", view))

    let win = NSMenu(title: "Fenster")
    win.addItem(withTitle: "Im Dock ablegen", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
    win.addItem(withTitle: "Schließen", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
    win.addItem(.separator())
    win.addItem(withTitle: "\(appName) zeigen", action: #selector(showWindow), keyEquivalent: "1")
    main.addItem(submenu("Fenster", win))
    NSApp.windowsMenu = win

    NSApp.mainMenu = main
  }

  func submenu(_ title: String, _ menu: NSMenu) -> NSMenuItem {
    let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
    menu.title = title
    item.submenu = menu
    return item
  }

  func buildStatusItem() {
    statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    if let img = NSImage(systemSymbolName: "arrow.down.circle", accessibilityDescription: appName) {
      img.isTemplate = true
      statusItem.button?.image = img
    } else {
      statusItem.button?.title = "↓"
    }
    let m = NSMenu()
    m.addItem(withTitle: "Fenster öffnen", action: #selector(showWindow), keyEquivalent: "")
    m.addItem(withTitle: "Downloads-Ordner öffnen", action: #selector(openDownloads), keyEquivalent: "")
    m.addItem(withTitle: "Im Browser öffnen", action: #selector(openInBrowser), keyEquivalent: "")
    m.addItem(.separator())
    lanItem = m.addItem(withTitle: "iPhone und iPad erlauben", action: #selector(toggleLan), keyEquivalent: "")
    lanItem.state = lanOn ? .on : .off
    updateItem = m.addItem(withTitle: "yt-dlp aktualisieren", action: #selector(updateYtDlp), keyEquivalent: "")
    m.addItem(withTitle: "Server neu starten", action: #selector(restartServer), keyEquivalent: "")
    m.addItem(.separator())
    m.addItem(withTitle: "\(appName) beenden", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    for item in m.items where item.action != #selector(NSApplication.terminate(_:)) { item.target = self }
    statusItem.menu = m
  }

  // MARK: Aktionen

  @objc func openInBrowser() { NSWorkspace.shared.open(baseURL) }

  @objc func openDownloads() {
    // Zielordner aus den Einstellungen des Servers, sonst der Standard.
    var req = URLRequest(url: baseURL.appendingPathComponent("api/status"))
    req.timeoutInterval = 2
    URLSession.shared.dataTask(with: req) { data, _, _ in
      let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
      let fallback = self.fm.urls(for: .downloadsDirectory, in: .userDomainMask)[0].appendingPathComponent("YouTube-Downloader").path
      let path = (json?["outputDir"] as? String) ?? fallback
      DispatchQueue.main.async {
        try? self.fm.createDirectory(atPath: path, withIntermediateDirectories: true)
        NSWorkspace.shared.open(URL(fileURLWithPath: path))
      }
    }.resume()
  }

  @objc func toggleLan() {
    lanOn.toggle()
    lanItem.state = lanOn ? .on : .off
    if lanOn {
      alert("iPhone und iPad erlaubt", "Mac und iPhone müssen im selben WLAN sein. Den QR-Code zum Koppeln findest du in der App unter Einstellungen → iPhone und iPad. Die Verbindung im Heimnetz ist nicht verschlüsselt, nur in vertrauenswürdigen Netzen nutzen.")
    }
    restartServer()
  }

  @objc func updateYtDlp() {
    updateItem.isEnabled = false
    updateItem.title = "yt-dlp wird aktualisiert …"
    let path = ytdlp.path
    let versionFile = userBin.appendingPathComponent("yt-dlp.version")
    DispatchQueue.global().async {
      let (code, out) = Self.run(path, ["-U"])
      let (_, version) = Self.run(path, ["--version"])
      let v = version.trimmingCharacters(in: .whitespacesAndNewlines)
      if code == 0, !v.isEmpty { try? v.write(to: versionFile, atomically: true, encoding: .utf8) }
      DispatchQueue.main.async {
        self.updateItem.isEnabled = true
        self.updateItem.title = "yt-dlp aktualisieren"
        if code == 0 {
          self.alert("yt-dlp ist aktuell", "Version \(v).")
        } else {
          self.alert("Update fehlgeschlagen", String(out.suffix(600)))
        }
      }
    }
  }

  static func run(_ path: String, _ args: [String]) -> (Int32, String) {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: path)
    p.arguments = args
    let pipe = Pipe()
    p.standardOutput = pipe
    p.standardError = pipe
    do { try p.run() } catch { return (-1, error.localizedDescription) }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    return (p.terminationStatus, String(decoding: data, as: UTF8.self))
  }

  func alert(_ title: String, _ text: String) {
    let a = NSAlert()
    a.messageText = title
    a.informativeText = text
    a.runModal()
  }

  // MARK: Web-Ansicht

  func isOwn(_ url: URL?) -> Bool {
    guard let url = url else { return false }
    if url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" { return true }
    return (url.host == "127.0.0.1" || url.host == "localhost") && url.port == port
  }

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    if action.shouldPerformDownload { return decisionHandler(.download) }
    if isOwn(action.request.url) { return decisionHandler(.allow) }
    // Fremde Links (YouTube, GitHub, Hilfe) im normalen Browser öffnen, nicht im App-Fenster.
    if let url = action.request.url, action.navigationType == .linkActivated || action.targetFrame == nil {
      NSWorkspace.shared.open(url)
    }
    decisionHandler(.cancel)
  }

  func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    let attachment = ((response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? "").lowercased().hasPrefix("attachment")
    decisionHandler(attachment || !response.canShowMIMEType ? .download : .allow)
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = action.request.url { NSWorkspace.shared.open(url) }
    return nil
  }

  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
    alert(appName, message)
    completionHandler()
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    let a = NSAlert()
    a.messageText = message
    a.addButton(withTitle: "OK")
    a.addButton(withTitle: "Abbrechen")
    completionHandler(a.runModal() == .alertFirstButtonReturn)
  }

  // Datei-Auswahl für „Importieren“ (input type=file).
  func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection
    panel.canChooseDirectories = false
    panel.beginSheetModal(for: window) { r in completionHandler(r == .OK ? panel.urls : nil) }
  }

  // „Exportieren“ und andere Downloads: Speicherort wie im Browser abfragen.
  func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
    let panel = NSSavePanel()
    panel.nameFieldStringValue = suggestedFilename
    panel.directoryURL = fm.urls(for: .downloadsDirectory, in: .userDomainMask).first
    panel.beginSheetModal(for: window) { r in
      guard r == .OK, let url = panel.url else { return completionHandler(nil) }
      try? self.fm.removeItem(at: url) // Überschreiben hat das Panel schon bestätigt
      completionHandler(url)
    }
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { reload() }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)

// SIGTERM (z. B. kill, Abmelden) sauber wie „Beenden“ behandeln, damit der Server mit aufhört.
signal(SIGTERM, SIG_IGN)
let termSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
termSource.setEventHandler { NSApp.terminate(nil) }
termSource.resume()

app.run()
