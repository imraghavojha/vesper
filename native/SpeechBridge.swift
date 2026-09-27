// On-device dictation bridge using SpeechAnalyzer and SpeechTranscriber.
import Foundation
import Darwin
import CoreMedia
@preconcurrency import AVFoundation
@preconcurrency import AVFAudio
@preconcurrency import Speech

private let maxLineBytes = 64 * 1024
private let maxLocaleLength = 64
private let maxTranscriptCharacters = 10_000
private let maxSessionSeconds = 120.0
private let audioQueueLimit = 64
private let defaultLocale = "en-US"

// MARK: - Output

struct StatusPayload: Encodable, Sendable {
    let available: Bool
    let locale: String
    let assets: String
    let microphone: String
}

struct Event: Encodable {
    var id: String
    var type: String
    var sessionId: String? = nil
    var status: StatusPayload? = nil
    var text: String? = nil
    var revision: Int? = nil
    var `final`: Bool? = nil
    var reason: String? = nil
    var code: String? = nil
    var message: String? = nil
}

@MainActor func emit(_ event: Event) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes]
    guard var data = try? encoder.encode(event) else { return }
    data.append(0x0A)
    data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
        guard let base = raw.baseAddress else { return }
        var offset = 0
        while offset < raw.count {
            let written = Darwin.write(STDOUT_FILENO, base + offset, raw.count - offset)
            if written < 0 {
                if errno == EINTR { continue }
                exit(0) // Parent disconnected; process exit releases audio resources.
            }
            offset += written
        }
    }
}

@MainActor func emitError(_ id: String?, _ code: String, _ message: String, sessionId: String? = nil) {
    emit(Event(id: id ?? "00000000-0000-4000-8000-000000000000", type: "error", sessionId: sessionId, code: code, message: message))
}

// MARK: - Speech helpers

func makeTranscriber(_ locale: Locale) -> SpeechTranscriber {
    SpeechTranscriber(locale: locale, transcriptionOptions: [], reportingOptions: [.volatileResults], attributeOptions: [])
}

func assetsString(_ status: AssetInventory.Status) -> String {
    switch status {
    case .installed: return "ready"
    case .supported: return "missing"
    case .downloading: return "downloading"
    case .unsupported: return "unsupported"
    @unknown default: return "unsupported"
    }
}

func microphoneString() -> String {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized: return "granted"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "not-determined"
    @unknown default: return "denied"
    }
}

func isValidLocale(_ value: String) -> Bool {
    guard !value.isEmpty, value.utf8.count <= maxLocaleLength else { return false }
    return value.utf8.allSatisfy { byte in
        let lower = byte | 0x20
        return (byte >= 0x30 && byte <= 0x39) || (lower >= 0x61 && lower <= 0x7A) || byte == 0x2D || byte == 0x5F
    }
}

func resolveLocale(_ identifier: String?) async -> Locale? {
    guard SpeechTranscriber.isAvailable else { return nil }
    return await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: identifier ?? defaultLocale))
}

func statusPayload(_ identifier: String?) async -> StatusPayload {
    let microphone = microphoneString()
    guard let locale = await resolveLocale(identifier) else {
        return StatusPayload(available: false, locale: identifier ?? defaultLocale, assets: "unsupported", microphone: microphone)
    }
    let status = await AssetInventory.status(forModules: [makeTranscriber(locale)])
    return StatusPayload(available: status != .unsupported, locale: locale.identifier(.bcp47),
                         assets: assetsString(status), microphone: microphone)
}

final class OnceResume: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Bool, Never>?
    init(_ continuation: CheckedContinuation<Bool, Never>) { self.continuation = continuation }
    func resume(_ value: Bool) {
        lock.lock()
        let pending = continuation
        continuation = nil
        lock.unlock()
        pending?.resume(returning: value)
    }
}

/// Returns true only if the operation completes without error before the deadline.
func race(seconds: Double, _ operation: @escaping @Sendable () async throws -> Void) async -> Bool {
    await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
        let once = OnceResume(continuation)
        let timer = Task { try? await Task.sleep(for: .seconds(seconds)); once.resume(false) }
        Task {
            do { try await operation(); once.resume(true) } catch { once.resume(false) }
            timer.cancel()
        }
    }
}

@MainActor final class Transcript {
    private var finalized = ""
    private var volatile = ""
    private(set) var revision = 0
    private(set) var overLimit = false
    var aborted = false

    func apply(_ result: SpeechTranscriber.Result) -> String {
        let text = String(result.text.characters)
        if result.isFinal {
            finalized = capped(finalized + text)
            volatile = ""
        } else {
            volatile = text
        }
        revision += 1
        return capped(finalized + volatile)
    }

    func finish() -> String {
        revision += 1
        return capped(finalized)
    }

    func discard() {
        finalized = ""
        volatile = ""
        aborted = true
    }

    private func capped(_ text: String) -> String {
        // The Electron/JavaScript contract measures UTF-16 code units.
        guard text.utf16.count > maxTranscriptCharacters else { return text }
        overLimit = true
        var result = ""
        var units = 0
        for scalar in text.unicodeScalars {
            let count = scalar.value > 0xFFFF ? 2 : 1
            if units + count > maxTranscriptCharacters { break }
            result.unicodeScalars.append(scalar)
            units += count
        }
        return result
    }
}

// MARK: - Audio tap

final class InputOnce: @unchecked Sendable {
    private var buffer: AVAudioPCMBuffer?
    init(_ buffer: AVAudioPCMBuffer) { self.buffer = buffer }
    func take() -> AVAudioPCMBuffer? { defer { buffer = nil }; return buffer }
}

/// Owned exclusively by one engine tap; the tap callback is serialized by AVAudioEngine.
final class TapProcessor: @unchecked Sendable {
    private let converter: AVAudioConverter
    private let continuation: AsyncStream<AnalyzerInput>.Continuation
    private let onFailure: @Sendable (String) -> Void
    private var failed = false

    init(converter: AVAudioConverter, continuation: AsyncStream<AnalyzerInput>.Continuation,
         onFailure: @escaping @Sendable (String) -> Void) {
        self.converter = converter
        self.continuation = continuation
        self.onFailure = onFailure
    }

    func process(_ buffer: AVAudioPCMBuffer) {
        guard !failed else { return }
        guard let converted = convert(buffer) else { return fail("audio-conversion-failed") }
        guard converted.frameLength > 0 else { return }
        switch continuation.yield(AnalyzerInput(buffer: converted)) {
        case .enqueued: break
        case .dropped: fail("audio-overflow")
        case .terminated: failed = true
        @unknown default: fail("audio-overflow")
        }
    }

    private func fail(_ code: String) {
        failed = true
        onFailure(code)
    }

    /// Converts into a freshly allocated buffer so the tap's buffer is never retained.
    private func convert(_ input: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        let ratio = converter.outputFormat.sampleRate / converter.inputFormat.sampleRate
        let capacity = AVAudioFrameCount((Double(input.frameLength) * ratio).rounded(.up)) + 1024
        guard let output = AVAudioPCMBuffer(pcmFormat: converter.outputFormat, frameCapacity: capacity) else { return nil }
        let source = InputOnce(input)
        var error: NSError?
        let status = converter.convert(to: output, error: &error) { _, inputStatus in
            if let next = source.take() {
                inputStatus.pointee = .haveData
                return next
            }
            inputStatus.pointee = .noDataNow
            return nil
        }
        return status == .error ? nil : output
    }
}

func makeTapBlock(_ processor: TapProcessor) -> AVAudioNodeTapBlock {
    { buffer, _ in processor.process(buffer) }
}

// MARK: - Capture session

@MainActor final class CaptureSession {
    enum Phase { case pending, running, stopping, done }

    let uuid: UUID
    let sessionId: String
    let startRequestId: String
    let localeIdentifier: String?
    let transcript = Transcript()
    var phase = Phase.pending
    var engine: AVAudioEngine?
    var tapInstalled = false
    var analyzer: SpeechAnalyzer?
    var continuation: AsyncStream<AnalyzerInput>.Continuation?
    var readerTask: Task<Void, Never>?
    var inputTask: Task<Void, Never>?
    var startTask: Task<Void, Never>?
    var readerFailed = false
    var inputFailed = false
    var timeoutTask: Task<Void, Never>?

    init(uuid: UUID, sessionId: String, startRequestId: String, localeIdentifier: String?) {
        self.uuid = uuid
        self.sessionId = sessionId
        self.startRequestId = startRequestId
        self.localeIdentifier = localeIdentifier
    }

    func stopAudio() {
        if let engine {
            if tapInstalled { engine.inputNode.removeTap(onBus: 0) }
            engine.stop()
        }
        tapInstalled = false
        engine = nil
        continuation?.finish()
        continuation = nil
    }

    func teardown() {
        stopAudio()
        startTask?.cancel()
        startTask = nil
        timeoutTask?.cancel()
        timeoutTask = nil
        readerTask?.cancel()
        readerTask = nil
        inputTask?.cancel()
        inputTask = nil
        if let analyzer { Task { await analyzer.cancelAndFinishNow() } }
        analyzer = nil
    }
}

// MARK: - Bridge

enum InputEvent: Sendable { case line(Data), oversized }

@MainActor final class Bridge {
    private var session: CaptureSession?
    private var preparing = false

    func handle(_ event: InputEvent) {
        guard case .line(let data) = event else {
            return emitError(nil, "line-too-long", "Input line exceeds the maximum length.")
        }
        guard let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            return emitError(nil, "invalid-json", "Input is not a JSON object.")
        }
        guard let id = object["id"] as? String, UUID(uuidString: id) != nil else {
            return emitError(nil, "invalid-id", "Command id must be a UUID.")
        }
        var sessionId: (text: String, uuid: UUID)?
        if let raw = object["sessionId"] {
            guard let text = raw as? String, let uuid = UUID(uuidString: text) else {
                return emitError(id, "invalid-session-id", "Session id must be a UUID.")
            }
            sessionId = (text, uuid)
        }
        var locale: String?
        if let raw = object["locale"] {
            guard let value = raw as? String, isValidLocale(value) else {
                return emitError(id, "invalid-locale", "Locale is invalid.")
            }
            locale = value
        }
        switch object["command"] as? String {
        case "status":
            Task {
                let payload = await statusPayload(locale)
                emit(Event(id: id, type: "status", status: payload))
            }
        case "prepare":
            prepare(id: id, locale: locale)
        case let command? where command == "start" || command == "stop" || command == "cancel":
            guard let sessionId else { return emitError(id, "missing-session-id", "Session id is required.") }
            if command == "start" {
                start(id: id, sessionId: sessionId.text, uuid: sessionId.uuid, locale: locale)
            } else {
                endCommand(id: id, sessionId: sessionId.text, uuid: sessionId.uuid, cancel: command == "cancel")
            }
        default:
            emitError(id, "unknown-command", "Unknown command.")
        }
    }

    func shutdown() async {
        guard let s = session else { return }
        let analyzer = s.analyzer
        cancelSession(s, requestId: s.startRequestId, reason: "eof")
        if let analyzer { _ = await race(seconds: 2) { await analyzer.cancelAndFinishNow() } }
    }

    private func prepare(id: String, locale: String?) {
        guard session == nil, !preparing else { return emitError(id, "busy", "Another operation is in progress.") }
        preparing = true
        Task {
            defer { self.preparing = false }
            guard let resolved = await resolveLocale(locale) else {
                return emitError(id, "unsupported", "Speech transcription is unavailable for this locale.")
            }
            let transcriber = makeTranscriber(resolved)
            do {
                if await AssetInventory.status(forModules: [transcriber]) != .installed {
                    let reserved = await AssetInventory.reservedLocales
                    if !reserved.contains(where: { $0.identifier(.bcp47) == resolved.identifier(.bcp47) }) {
                        try await AssetInventory.reserve(locale: resolved)
                    }
                    if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
                        try await request.downloadAndInstall()
                    }
                }
            } catch {
                return emitError(id, "asset-install-failed", "Speech assets could not be installed.")
            }
            let payload = await statusPayload(locale)
            emit(Event(id: id, type: "status", status: payload))
        }
    }

    private func start(id: String, sessionId: String, uuid: UUID, locale: String?) {
        guard session == nil, !preparing else {
            emitError(id, "busy", "Another operation is in progress.", sessionId: sessionId)
            if session == nil {
                emit(Event(id: id, type: "stopped", sessionId: sessionId, final: false, reason: "failure"))
            }
            return
        }
        let s = CaptureSession(uuid: uuid, sessionId: sessionId, startRequestId: id, localeIdentifier: locale)
        session = s // Reserved synchronously, before any await.
        s.timeoutTask = Task {
            try? await Task.sleep(for: .seconds(maxSessionSeconds))
            guard !Task.isCancelled else { return }
            self.beginStop(s, requestId: s.startRequestId, reason: "timeout")
        }
        s.startTask = Task { await self.runStart(s) }
    }

    private func endCommand(id: String, sessionId: String, uuid: UUID, cancel: Bool) {
        guard let s = session, s.uuid == uuid else {
            return emitError(id, "session-mismatch", "No matching active session.", sessionId: sessionId)
        }
        if cancel {
            cancelSession(s, requestId: id, reason: "cancelled")
        } else if s.phase == .stopping {
            emitError(id, "already-stopping", "Session is already stopping.", sessionId: sessionId)
        } else {
            beginStop(s, requestId: id, reason: "stopped")
        }
    }

    private func runStart(_ s: CaptureSession) async {
        func alive() -> Bool { session === s && s.phase == .pending }
        guard let locale = await resolveLocale(s.localeIdentifier) else {
            return failSession(s, "unsupported", "Speech transcription is unavailable for this locale.")
        }
        guard alive() else { return s.teardown() }
        let transcriber = makeTranscriber(locale)
        guard await AssetInventory.status(forModules: [transcriber]) == .installed else {
            return failSession(s, "assets-missing", "Speech assets are not installed.")
        }
        guard alive() else { return s.teardown() }
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            break
        case .notDetermined:
            let granted = await AVCaptureDevice.requestAccess(for: .audio)
            guard alive() else { return s.teardown() }
            guard granted else { return failSession(s, "microphone-denied", "Microphone access was not granted.") }
        default:
            return failSession(s, "microphone-denied", "Microphone access was not granted.")
        }

        let engine = AVAudioEngine()
        s.engine = engine
        let inputFormat = engine.inputNode.outputFormat(forBus: 0)
        guard inputFormat.sampleRate > 0, inputFormat.channelCount > 0 else {
            return failSession(s, "no-microphone", "No usable microphone input is available.")
        }
        guard let analyzerFormat = await SpeechAnalyzer.bestAvailableAudioFormat(
            compatibleWith: [transcriber], considering: inputFormat) else {
            return failSession(s, "audio-format", "No compatible audio format is available.")
        }
        guard alive() else { return s.teardown() }
        guard let converter = AVAudioConverter(from: inputFormat, to: analyzerFormat) else {
            return failSession(s, "audio-format", "No compatible audio format is available.")
        }
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        s.analyzer = analyzer
        let (stream, continuation) = AsyncStream.makeStream(
            of: AnalyzerInput.self, bufferingPolicy: .bufferingOldest(audioQueueLimit))
        s.continuation = continuation
        do {
            try await analyzer.prepareToAnalyze(in: analyzerFormat)
            guard alive() else { return s.teardown() }
            s.readerTask = Task {
                do {
                    for try await result in transcriber.results { self.applyResult(result, to: s) }
                } catch {
                    guard !Task.isCancelled else { return }
                    s.readerFailed = true
                    if s.phase == .running { self.failSession(s, "recognition-failed", "Speech recognition failed.") }
                }
            }
            // start consumes the stream: it must not block installation of its producer.
            s.inputTask = Task {
                do { try await analyzer.start(inputSequence: stream) }
                catch {
                    guard !Task.isCancelled else { return }
                    s.inputFailed = true
                    self.failSession(s, "analyzer-failed", "Speech analyzer could not process audio.")
                }
            }
        } catch {
            return failSession(s, "analyzer-failed", "Speech analyzer could not start.")
        }
        guard alive() else { return s.teardown() }

        let processor = TapProcessor(converter: converter, continuation: continuation) { code in
            Task { @MainActor in self.failSession(s, code, "Audio capture failed.") }
        }
        engine.inputNode.installTap(onBus: 0, bufferSize: 4096, format: inputFormat, block: makeTapBlock(processor))
        s.tapInstalled = true
        engine.prepare()
        do { try engine.start() } catch {
            return failSession(s, "microphone-failed", "Microphone capture could not start.")
        }
        s.phase = .running
        emit(Event(id: s.startRequestId, type: "started", sessionId: s.sessionId))
    }

    private func applyResult(_ result: SpeechTranscriber.Result, to s: CaptureSession) {
        guard session === s, s.phase == .running || s.phase == .stopping else { return }
        let text = s.transcript.apply(result)
        emit(Event(id: s.startRequestId, type: "transcript", sessionId: s.sessionId,
                   text: text, revision: s.transcript.revision, final: false))
        if s.transcript.overLimit, s.phase == .running {
            beginStop(s, requestId: s.startRequestId, reason: "limit")
        }
    }

    private func beginStop(_ s: CaptureSession, requestId: String, reason: String) {
        guard session === s else { return }
        switch s.phase {
        case .pending: return cancelSession(s, requestId: requestId, reason: reason)
        case .running: break
        case .stopping, .done: return
        }
        s.phase = .stopping
        s.timeoutTask?.cancel()
        s.stopAudio()
        let analyzer = s.analyzer
        let reader = s.readerTask
        let input = s.inputTask
        Task {
            var ok = true
            if let input { ok = await race(seconds: 10) { await input.value } }
            if ok, let analyzer { ok = await race(seconds: 10) { try await analyzer.finalizeAndFinishThroughEndOfInput() } }
            else { ok = false }
            if ok, let reader { ok = await race(seconds: 5) { await reader.value } }
            ok = ok && !s.readerFailed && !s.inputFailed
            guard self.session === s, s.phase == .stopping else { return }
            s.phase = .done
            self.session = nil
            if ok {
                let text = s.transcript.finish()
                emit(Event(id: s.startRequestId, type: "transcript", sessionId: s.sessionId,
                           text: text, revision: s.transcript.revision, final: true))
                emit(Event(id: requestId, type: "stopped", sessionId: s.sessionId, final: true, reason: reason))
            } else {
                emitError(requestId, "finalization-failed", "Transcription could not be finalized.", sessionId: s.sessionId)
                emit(Event(id: requestId, type: "stopped", sessionId: s.sessionId, final: false, reason: "failure"))
            }
            s.teardown()
        }
    }

    private func cancelSession(_ s: CaptureSession, requestId: String, reason: String) {
        guard session === s, s.phase != .done else { return s.teardown() }
        s.phase = .done
        session = nil
        s.transcript.discard()
        s.teardown()
        emit(Event(id: requestId, type: "stopped", sessionId: s.sessionId, final: false, reason: reason))
    }

    private func failSession(_ s: CaptureSession, _ code: String, _ message: String) {
        guard session === s, s.phase == .pending || s.phase == .running else { return }
        s.phase = .done
        session = nil
        s.teardown()
        emitError(s.startRequestId, code, message, sessionId: s.sessionId)
        emit(Event(id: s.startRequestId, type: "stopped", sessionId: s.sessionId, final: false, reason: "failure"))
    }
}

// MARK: - File validation mode

@MainActor func transcribeFile(path: String) async -> Int32 {
    let requestId = UUID().uuidString.lowercased()
    let sessionId = UUID().uuidString.lowercased()
    func fail(_ code: String, _ message: String, exitCode: Int32 = 1) -> Int32 {
        emitError(requestId, code, message, sessionId: sessionId)
        return exitCode
    }
    guard let locale = await resolveLocale(nil) else {
        return fail("unsupported", "Speech transcription is unavailable for this locale.")
    }
    let transcriber = makeTranscriber(locale)
    guard await AssetInventory.status(forModules: [transcriber]) == .installed else {
        return fail("assets-missing", "Speech assets are not installed.", exitCode: 2)
    }
    let file: AVAudioFile
    do { file = try AVAudioFile(forReading: URL(fileURLWithPath: path)) } catch {
        return fail("file-unreadable", "Audio file could not be read.")
    }
    let rate = file.processingFormat.sampleRate
    guard rate > 0, file.length > 0, Double(file.length) / rate <= maxSessionSeconds else {
        return fail("file-invalid", "Audio file is empty or too long.")
    }

    emit(Event(id: requestId, type: "started", sessionId: sessionId))
    let transcript = Transcript()
    let analyzer = SpeechAnalyzer(modules: [transcriber])
    let reader = Task { () -> Bool in
        do {
            for try await result in transcriber.results {
                let text = transcript.apply(result)
                emit(Event(id: requestId, type: "transcript", sessionId: sessionId,
                           text: text, revision: transcript.revision, final: false))
            }
            return true
        } catch {
            return false
        }
    }
    let watchdog = Task {
        try? await Task.sleep(for: .seconds(maxSessionSeconds))
        guard !Task.isCancelled else { return }
        transcript.aborted = true
        Task { await analyzer.cancelAndFinishNow() }
        emitError(requestId, "transcription-timeout", "Transcription exceeded its time limit.", sessionId: sessionId)
        emit(Event(id: requestId, type: "stopped", sessionId: sessionId, final: false, reason: "timeout"))
        exit(1)
    }
    var ok = true
    do {
        if let end = try await analyzer.analyzeSequence(from: file) {
            try await analyzer.finalizeAndFinish(through: end)
        } else {
            try await analyzer.finalizeAndFinishThroughEndOfInput()
        }
    } catch {
        ok = false
        await analyzer.cancelAndFinishNow()
    }
    ok = await reader.value && ok && !transcript.aborted
    watchdog.cancel()

    if ok {
        let text = transcript.finish()
        emit(Event(id: requestId, type: "transcript", sessionId: sessionId,
                   text: text, revision: transcript.revision, final: true))
        emit(Event(id: requestId, type: "stopped", sessionId: sessionId, final: true, reason: "completed"))
        return 0
    }
    emitError(requestId, "transcription-failed", "Transcription could not be completed.", sessionId: sessionId)
    emit(Event(id: requestId, type: "stopped", sessionId: sessionId, final: false, reason: "failure"))
    return 1
}

// MARK: - Stdin

/// Blocking reader on its own thread; lines are capped and the semaphore bounds queued lines.
func startStdinReader(_ continuation: AsyncStream<InputEvent>.Continuation, _ credits: DispatchSemaphore) {
    let thread = Thread {
        func deliver(_ event: InputEvent) {
            credits.wait()
            continuation.yield(event)
        }
        var line = [UInt8]()
        line.reserveCapacity(4096)
        var discarding = false
        var chunk = [UInt8](repeating: 0, count: 4096)
        while true {
            let count = chunk.withUnsafeMutableBytes { Darwin.read(STDIN_FILENO, $0.baseAddress, $0.count) }
            if count < 0 {
                if errno == EINTR { continue }
                break
            }
            if count == 0 { break }
            for byte in chunk[0..<count] {
                if byte == 0x0A {
                    if discarding {
                        deliver(.oversized)
                    } else {
                        if line.last == 0x0D { line.removeLast() }
                        if !line.isEmpty { deliver(.line(Data(line))) }
                    }
                    line.removeAll(keepingCapacity: true)
                    discarding = false
                } else if !discarding {
                    if line.count >= maxLineBytes {
                        discarding = true
                        line.removeAll(keepingCapacity: true)
                    } else {
                        line.append(byte)
                    }
                }
            }
        }
        if discarding { deliver(.oversized) } else if !line.isEmpty { deliver(.line(Data(line))) }
        continuation.finish()
    }
    thread.start()
}

@main
struct SpeechBridge {
    @MainActor static func main() async {
        signal(SIGPIPE, SIG_IGN)
        let arguments = CommandLine.arguments
        if arguments.count == 3, arguments[1] == "--transcribe-file" {
            let code = await transcribeFile(path: arguments[2])
            exit(code)
        }
        guard arguments.count == 1 else { exit(64) }

        let bridge = Bridge()
        let credits = DispatchSemaphore(value: 64)
        let (stream, continuation) = AsyncStream.makeStream(of: InputEvent.self)
        startStdinReader(continuation, credits)
        for await event in stream {
            credits.signal()
            bridge.handle(event)
        }
        await bridge.shutdown()
        exit(0)
    }
}
