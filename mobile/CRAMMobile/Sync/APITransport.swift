import Foundation

struct TransportResponse: Sendable {
    let statusCode: Int
    let statusText: String
    let headers: [String: String]
    let body: Data

    func markingOfflineReplay() -> TransportResponse {
        var markedHeaders = headers
        markedHeaders["X-CRAM-Offline"] = "true"
        return TransportResponse(
            statusCode: statusCode,
            statusText: statusText,
            headers: markedHeaders,
            body: body
        )
    }
}

protocol APITransporting: Sendable {
    func response(for request: URLRequest) async throws -> TransportResponse
}

protocol NetworkLoading: Sendable {
    func data(for request: URLRequest) async throws -> (Data, URLResponse)
}

struct URLSessionNetworkLoader: NetworkLoading {
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        try await session.data(for: request)
    }
}

actor OfflineAPITransport: APITransporting {
    private static let blockedForwardedHeaders = Set([
        "accept-encoding",
        "content-length",
        "host",
        "origin",
        "referer",
        "sec-fetch-dest",
        "sec-fetch-mode",
        "sec-fetch-site",
        "sec-fetch-user",
    ])

    private let serverURL: URL
    private let cache: any ResponseCaching
    private let network: any NetworkLoading

    init(
        serverURL: URL,
        cache: any ResponseCaching,
        network: any NetworkLoading = URLSessionNetworkLoader()
    ) {
        self.serverURL = serverURL
        self.cache = cache
        self.network = network
    }

    func response(for incoming: URLRequest) async throws -> TransportResponse {
        guard let incomingURL = incoming.url else {
            throw APITransportError.invalidRequestURL
        }
        let method = (incoming.httpMethod ?? "GET").uppercased()
        let cacheable = method == "GET" && OfflineCachePolicy.isCacheable(incomingURL)
        let key = incomingURL.absoluteString

        do {
            let upstream = try upstreamRequest(from: incoming)
            let (data, response) = try await network.data(for: upstream)
            guard let http = response as? HTTPURLResponse else {
                throw APITransportError.nonHTTPResponse
            }
            let result = TransportResponse(
                statusCode: http.statusCode,
                statusText: HTTPURLResponse.localizedString(forStatusCode: http.statusCode),
                headers: Self.stringHeaders(http.allHeaderFields),
                body: data
            )
            if cacheable && http.statusCode < 500 {
                try? await cache.put(result.cachedValue, for: key)
            }
            return result
        } catch {
            if cacheable, let cached = try? await cache.value(for: key) {
                return TransportResponse(cached).markingOfflineReplay()
            }
            throw error
        }
    }

    private func upstreamRequest(from incoming: URLRequest) throws -> URLRequest {
        guard
            let incomingURL = incoming.url,
            var upstreamComponents = URLComponents(url: serverURL, resolvingAgainstBaseURL: false),
            let incomingComponents = URLComponents(url: incomingURL, resolvingAgainstBaseURL: false)
        else {
            throw APITransportError.invalidRequestURL
        }

        var basePath = upstreamComponents.percentEncodedPath
        while basePath.hasSuffix("/") {
            basePath.removeLast()
        }
        upstreamComponents.percentEncodedPath = basePath + incomingComponents.percentEncodedPath
        upstreamComponents.percentEncodedQuery = incomingComponents.percentEncodedQuery
        upstreamComponents.fragment = nil
        guard let url = upstreamComponents.url else {
            throw APITransportError.invalidRequestURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = incoming.httpMethod
        request.httpBody = incoming.httpBody
        request.timeoutInterval = 30
        for (name, value) in incoming.allHTTPHeaderFields ?? [:]
        where !Self.blockedForwardedHeaders.contains(name.lowercased()) {
            request.setValue(value, forHTTPHeaderField: name)
        }
        request.setValue("mobile", forHTTPHeaderField: "X-CRAM-Client")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        return request
    }

    private static func stringHeaders(_ headers: [AnyHashable: Any]) -> [String: String] {
        headers.reduce(into: [:]) { result, pair in
            result[String(describing: pair.key)] = String(describing: pair.value)
        }
    }
}

enum APITransportError: LocalizedError {
    case invalidRequestURL
    case nonHTTPResponse

    var errorDescription: String? {
        switch self {
        case .invalidRequestURL:
            return "The app created an invalid CRAM API request."
        case .nonHTTPResponse:
            return "The CRAM server returned an invalid response."
        }
    }
}

private extension TransportResponse {
    var cachedValue: CachedHTTPResponse {
        CachedHTTPResponse(
            statusCode: statusCode,
            statusText: statusText,
            headers: headers,
            body: body
        )
    }

    init(_ cached: CachedHTTPResponse) {
        self.init(
            statusCode: cached.statusCode,
            statusText: cached.statusText,
            headers: cached.headers,
            body: cached.body
        )
    }
}
