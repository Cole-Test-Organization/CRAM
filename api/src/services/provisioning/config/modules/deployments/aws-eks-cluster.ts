import type { DeploymentModule } from "../types.js";

const deployment = {
  "name": "aws-eks-cluster",
  "providerProfile": "aws-lab",
  "provider": {
    "projectName": "eks-broker-test",
    "vpcCidr": "10.150.0.0/16"
  },
  "steps": [
    {
      "name": "eks-cluster-up",
      "action": "up",
      "targets": [
        "eks-broker-test"
      ],
      "description": "Terraform creates an EKS cluster, ECR repository, pushes the local health API image, and exposes it with a Kubernetes LoadBalancer service."
    },
    {
      "name": "eks-app-verify",
      "action": "verify-http-200",
      "targets": [
        "eks-broker-test"
      ],
      "description": "Broker verifies the exposed health API returns HTTP 200."
    }
  ],
  "resources": [
    {
      "kind": "eks-cluster",
      "name": "eks-broker-test",
      "hostname": "eks-broker-test",
      "cluster": {
        "kubernetesVersion": null,
        "availabilityZoneCount": 2
      },
      "nodeGroup": {
        "instanceTypes": [
          "t3.medium"
        ],
        "desiredSize": 1,
        "minSize": 1,
        "maxSize": 1,
        "diskSizeGb": 20
      },
      "app": {
        "name": "broker-health-api",
        "namespace": "default",
        "contextPath": "apps/eks-health-api",
        "imageTag": "slot-05",
        "replicas": 1,
        "port": 80,
        "containerPort": 8080,
        "verifyPath": "/healthz",
        "verifyTimeoutSeconds": 900
      },
      "placement": {
        "provider": "aws",
        "network": {
          "mode": "managed",
          "vpcCidr": "10.150.0.0/16",
          "availabilityZoneCount": 2,
          "subnetNewbits": 8,
          "subnetStartIndex": 0
        }
      }
    }
  ]
} satisfies DeploymentModule;

export default deployment;
