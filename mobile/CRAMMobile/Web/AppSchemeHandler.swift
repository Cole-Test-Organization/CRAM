import Foundation
import WebKit

@MainActor
final class AppSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "cram"
    static let host = "app"

    private struct Payload {
        let response: URLResponse
        let data: Data
    }

    private let resourceRoot: URL
    private let transport: any APITransporting
    private var runningTasks: [ObjectIdentifier: Task<Void, Never>] = [:]

    init(resourceRoot: URL, transport: any APITransporting) {
        self.resourceRoot = resourceRoot.standardizedFileURL
        self.transport = transport
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
        let identifier = ObjectIdentifier(urlSchemeTask)
        let task = Task { [weak self] in
            guard let self else { return }
            defer { runningTasks.removeValue(forKey: identifier) }
            do {
                let payload = try await payload(for: urlSchemeTask.request)
                try Task.checkCancellation()
                urlSchemeTask.didReceive(payload.response)
                urlSchemeTask.didReceive(payload.data)
                urlSchemeTask.didFinish()
            } catch is CancellationError {
                // WebKit explicitly stopped this load; do not send callbacks.
            } catch {
                guard !Task.isCancelled else { return }
                urlSchemeTask.didFailWithError(error)
            }
        }
        runningTasks[identifier] = task
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {
        let identifier = ObjectIdentifier(urlSchemeTask)
        runningTasks.removeValue(forKey: identifier)?.cancel()
    }

    private func payload(for request: URLRequest) async throws -> Payload {
        guard
            let url = request.url,
            url.scheme == Self.scheme,
            url.host == Self.host
        else {
            throw AppSchemeError.unrecognizedURL
        }

        if url.path == "/api" || url.path.hasPrefix("/api/") {
            return try await apiPayload(for: request, url: url)
        }
        return try staticPayload(for: url)
    }

    private func apiPayload(for request: URLRequest, url: URL) async throws -> Payload {
        let result = try await transport.response(for: request)
        guard let response = HTTPURLResponse(
            url: url,
            statusCode: result.statusCode,
            httpVersion: "HTTP/1.1",
            headerFields: result.headers
        ) else {
            throw AppSchemeError.invalidResponse
        }
        return Payload(response: response, data: result.body)
    }

    private func staticPayload(for url: URL) throws -> Payload {
        let requestedPath = url.path.removingPercentEncoding ?? url.path
        let relativePath = requestedPath.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let candidate = resourceRoot
            .appendingPathComponent(relativePath.isEmpty ? "index.html" : relativePath)
            .standardizedFileURL
        let rootPrefix = resourceRoot.path.hasSuffix("/")
            ? resourceRoot.path
            : resourceRoot.path + "/"

        let selected: URL
        if candidate.path.hasPrefix(rootPrefix), FileManager.default.fileExists(atPath: candidate.path) {
            selected = candidate
        } else {
            selected = resourceRoot.appendingPathComponent("index.html")
        }
        guard selected.path.hasPrefix(rootPrefix), FileManager.default.fileExists(atPath: selected.path) else {
            throw AppSchemeError.missingRenderer
        }

        let data = try Data(contentsOf: selected)
        let headers = [
            "Cache-Control": selected.lastPathComponent == "index.html"
                ? "no-cache"
                : "public, max-age=31536000, immutable",
            "Content-Type": Self.mimeType(for: selected.pathExtension),
            "Content-Security-Policy": Self.contentSecurityPolicy,
            "X-Content-Type-Options": "nosniff",
        ]
        guard let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: headers
        ) else {
            throw AppSchemeError.invalidResponse
        }
        return Payload(response: response, data: data)
    }

    private static let contentSecurityPolicy = [
        "default-src 'self'",
        "base-uri 'none'",
        "connect-src 'self'",
        "font-src 'self' data:",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "img-src 'self' data: blob: https: http:",
        "manifest-src 'self'",
        "object-src 'none'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "worker-src 'self'",
    ].joined(separator: "; ")

    private static func mimeType(for pathExtension: String) -> String {
        switch pathExtension.lowercased() {
        case "css": return "text/css; charset=utf-8"
        case "html": return "text/html; charset=utf-8"
        case "ico": return "image/x-icon"
        case "jpeg", "jpg": return "image/jpeg"
        case "js": return "text/javascript; charset=utf-8"
        case "json", "map": return "application/json; charset=utf-8"
        case "png": return "image/png"
        case "svg": return "image/svg+xml"
        case "txt": return "text/plain; charset=utf-8"
        case "webmanifest": return "application/manifest+json; charset=utf-8"
        case "woff": return "font/woff"
        case "woff2": return "font/woff2"
        default: return "application/octet-stream"
        }
    }
}

enum AppSchemeError: LocalizedError {
    case invalidResponse
    case missingRenderer
    case unrecognizedURL

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "CRAM Mobile could not create a WebKit response."
        case .missingRenderer:
            return "The bundled CRAM interface is missing. Rebuild the mobile app from the repository."
        case .unrecognizedURL:
            return "CRAM Mobile blocked an unrecognized app URL."
        }
    }
}
