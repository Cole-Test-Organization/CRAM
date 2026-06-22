import type { ResourceProfileModule } from "../types.js";

const resourceProfile = {
  "name": "aws-egress-route",
  "provider": "aws",
  "kind": "egress-route",
  "terraform": {
    "stack": "terraform/aws-egress-route",
    "outputs": {
      "providerResourceId": "route.id"
    },
    "environment": {
      "AWS_PROFILE": {
        "envPath": "provider.profileEnv",
        "optional": true
      }
    },
    "vars": {
      "region": {
        "path": "provider.region"
      },
      "project_name": {
        "first": [
          {
            "path": "provider.projectName"
          },
          {
            "path": "deployment.name"
          }
        ]
      },
      "hostname": {
        "path": "resource.hostname"
      },
      "route_table_id": {
        "first": [
          {
            "path": "placement.network.routeTableId"
          },
          {
            "path": "placement.routeTableId"
          }
        ]
      },
      "destination_cidr_block": {
        "first": [
          {
            "path": "placement.network.destinationCidr"
          },
          {
            "path": "placement.destinationCidr"
          },
          {
            "value": "0.0.0.0/0"
          }
        ]
      },
      "next_hop_network_interface_id": {
        "first": [
          {
            "path": "placement.network.nextHop.networkInterfaceId"
          },
          {
            "path": "placement.network.nextHop.id"
          },
          {
            "path": "placement.nextHopNetworkInterfaceId"
          }
        ]
      }
    }
  }
} satisfies ResourceProfileModule;

export default resourceProfile;
