import XCTest
@testable import CRAMMobile

final class APITransportTests: XCTestCase {
    func testReplaysCachedCoreReadWhenNetworkIsUnavailable() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = FileResponseCache(directory: directory)
        let requestURL = URL(string: "cram://app/api/accounts?sort=name")!
        let cached = CachedHTTPResponse(
            statusCode: 200,
            statusText: "ok",
            headers: ["Content-Type": "application/json"],
            body: Data(#"{"accounts":[{"id":7}]}"#.utf8)
        )
        try await cache.put(cached, for: requestURL.absoluteString)
        let transport = OfflineAPITransport(
            serverURL: URL(string: "https://crm.example.com")!,
            cache: cache,
            network: FailingNetwork()
        )

        let response = try await transport.response(for: URLRequest(url: requestURL))

        XCTAssertEqual(response.statusCode, 200)
        XCTAssertEqual(response.headers["X-CRAM-Offline"], "true")
        XCTAssertEqual(response.body, cached.body)
    }

    func testNeverReplaysOperationalData() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = FileResponseCache(directory: directory)
        let requestURL = URL(string: "cram://app/api/provisioning/secrets")!
        try await cache.put(
            CachedHTTPResponse(
                statusCode: 200,
                statusText: "ok",
                headers: [:],
                body: Data("secret".utf8)
            ),
            for: requestURL.absoluteString
        )
        let transport = OfflineAPITransport(
            serverURL: URL(string: "https://crm.example.com")!,
            cache: cache,
            network: FailingNetwork()
        )

        do {
            _ = try await transport.response(for: URLRequest(url: requestURL))
            XCTFail("Operational data must not replay from the offline cache")
        } catch {
            XCTAssertEqual((error as? URLError)?.code, .notConnectedToInternet)
        }
    }
}

private struct FailingNetwork: NetworkLoading {
    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        throw URLError(.notConnectedToInternet)
    }
}
