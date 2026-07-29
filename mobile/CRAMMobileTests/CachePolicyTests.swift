import XCTest
@testable import CRAMMobile

final class CachePolicyTests: XCTestCase {
    func testIncludesCoreCRMReads() {
        XCTAssertTrue(isCacheable("cram://app/api/accounts?sort=name"))
        XCTAssertTrue(isCacheable("cram://app/api/accounts/7/details"))
        XCTAssertTrue(isCacheable("cram://app/api/notes?account_id=7"))
        XCTAssertTrue(isCacheable("cram://app/api/threads/9"))
    }

    func testExcludesOperationalAndSecretBearingSurfaces() {
        XCTAssertFalse(isCacheable("cram://app/api/provisioning/secrets"))
        XCTAssertFalse(isCacheable("cram://app/api/backup/settings"))
        XCTAssertFalse(isCacheable("cram://app/api/agent/sessions"))
        XCTAssertFalse(isCacheable("https://crm.example.com/api/accounts"))
    }

    private func isCacheable(_ value: String) -> Bool {
        guard let url = URL(string: value) else {
            XCTFail("Invalid test URL")
            return false
        }
        return OfflineCachePolicy.isCacheable(url)
    }
}
