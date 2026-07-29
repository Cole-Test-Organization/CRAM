import Foundation
import WebKit

enum MobileBridgeScript {
    static let source = #"""
    (() => {
      const send = (action, payload = {}) =>
        window.webkit.messageHandlers.cramMobile.postMessage({ action, ...payload });
      window.cramMobile = Object.freeze({
        isMobile: true,
        cache: Object.freeze({
          put: (key, response) => send("cache.put", { key, response }),
          get: (key) => send("cache.get", { key }),
          keys: () => send("cache.keys"),
          delete: (key) => send("cache.delete", { key }),
        }),
        openMeetingNotes: (meetingId) => send("meeting.open", { meetingId }),
        openSettings: () => send("settings.open"),
      });
    })();
    """#
}

@MainActor
final class MobileBridgeHandler: NSObject, WKScriptMessageHandlerWithReply {
    private let cache: any ResponseCaching
    private let onOpenMeetingNotes: (Int) -> Void
    private let onOpenSettings: () -> Void

    init(
        cache: any ResponseCaching,
        onOpenMeetingNotes: @escaping (Int) -> Void,
        onOpenSettings: @escaping () -> Void
    ) {
        self.cache = cache
        self.onOpenMeetingNotes = onOpenMeetingNotes
        self.onOpenSettings = onOpenSettings
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard
            message.frameInfo.isMainFrame,
            let body = message.body as? [String: Any],
            let action = body["action"] as? String
        else {
            replyHandler(nil, "CRAM Mobile rejected an invalid bridge request.")
            return
        }

        switch action {
        case "cache.put":
            put(body, replyHandler: replyHandler)
        case "cache.get":
            get(body, replyHandler: replyHandler)
        case "cache.keys":
            Task {
                do {
                    replyHandler(try await cache.keys(), nil)
                } catch {
                    replyHandler(nil, error.localizedDescription)
                }
            }
        case "cache.delete":
            guard let key = cacheKey(from: body) else {
                replyHandler(nil, "CRAM Mobile rejected an invalid cache key.")
                return
            }
            Task {
                do {
                    try await cache.delete(key)
                    replyHandler(["deleted": true], nil)
                } catch {
                    replyHandler(nil, error.localizedDescription)
                }
            }
        case "meeting.open":
            guard
                let number = body["meetingId"] as? NSNumber,
                number.intValue > 0,
                number.doubleValue == Double(number.intValue)
            else {
                replyHandler(nil, "A positive meeting id is required.")
                return
            }
            onOpenMeetingNotes(number.intValue)
            replyHandler(["opened": true, "meetingId": number.intValue], nil)
        case "settings.open":
            onOpenSettings()
            replyHandler(["opened": true], nil)
        default:
            replyHandler(nil, "CRAM Mobile rejected an unknown bridge action.")
        }
    }

    private func put(
        _ body: [String: Any],
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard
            let key = cacheKey(from: body),
            let value = body["response"] as? [String: Any],
            let status = value["status"] as? NSNumber,
            (100...599).contains(status.intValue),
            let statusText = value["statusText"] as? String,
            let bodyBase64 = value["bodyBase64"] as? String,
            let responseBody = Data(base64Encoded: bodyBase64),
            let rawHeaders = value["headers"] as? [String: Any]
        else {
            replyHandler(nil, "CRAM Mobile rejected an invalid cached response.")
            return
        }
        let headers = rawHeaders.reduce(into: [String: String]()) { result, pair in
            if let value = pair.value as? String {
                result[pair.key] = value
            }
        }
        let response = CachedHTTPResponse(
            statusCode: status.intValue,
            statusText: statusText,
            headers: headers,
            body: responseBody
        )
        Task {
            do {
                try await cache.put(response, for: key)
                replyHandler(["stored": true], nil)
            } catch {
                replyHandler(nil, error.localizedDescription)
            }
        }
    }

    private func get(
        _ body: [String: Any],
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard let key = cacheKey(from: body) else {
            replyHandler(nil, "CRAM Mobile rejected an invalid cache key.")
            return
        }
        Task {
            do {
                guard let response = try await cache.value(for: key) else {
                    replyHandler(NSNull(), nil)
                    return
                }
                replyHandler([
                    "status": response.statusCode,
                    "statusText": response.statusText,
                    "headers": response.headers,
                    "bodyBase64": response.body.base64EncodedString(),
                ], nil)
            } catch {
                replyHandler(nil, error.localizedDescription)
            }
        }
    }

    private func cacheKey(from body: [String: Any]) -> String? {
        guard
            let key = body["key"] as? String,
            let url = URL(string: key),
            url.scheme == AppSchemeHandler.scheme,
            url.host == AppSchemeHandler.host,
            OfflineCachePolicy.isCacheable(url)
        else {
            return nil
        }
        return key
    }
}
