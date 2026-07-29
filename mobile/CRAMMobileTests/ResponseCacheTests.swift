import XCTest
@testable import CRAMMobile

final class ResponseCacheTests: XCTestCase {
    func testRoundTripsAndPrunesEndpointResponses() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = FileResponseCache(directory: directory)
        let firstKey = "cram://app/api/accounts?sort=name"
        let secondKey = "cram://app/api/contacts"
        let response = CachedHTTPResponse(
            statusCode: 200,
            statusText: "ok",
            headers: ["Content-Type": "application/json"],
            body: Data(#"{"accounts":[]}"#.utf8)
        )

        try await cache.put(response, for: firstKey)
        try await cache.put(response, for: secondKey)
        let firstValue = try await cache.value(for: firstKey)
        XCTAssertEqual(firstValue, response)

        try await cache.prune(keeping: [firstKey])

        let remainingKeys = try await cache.keys()
        let secondValue = try await cache.value(for: secondKey)
        XCTAssertEqual(remainingKeys, [firstKey])
        XCTAssertNil(secondValue)
    }
}
