import XCTest
@testable import CRAMMobile

final class EndpointIdentityTests: XCTestCase {
    func testEndpointIdentityIsStableAndIsolated() {
        let first = URL(string: "https://crm.example.com")!
        let second = URL(string: "https://other.example.com")!

        XCTAssertEqual(
            EndpointIdentity.storageKey(for: first),
            EndpointIdentity.storageKey(for: first)
        )
        XCTAssertNotEqual(
            EndpointIdentity.storageKey(for: first),
            EndpointIdentity.storageKey(for: second)
        )
        XCTAssertNotEqual(
            EndpointIdentity.websiteDataStoreIdentifier(for: first),
            EndpointIdentity.websiteDataStoreIdentifier(for: second)
        )
    }
}
