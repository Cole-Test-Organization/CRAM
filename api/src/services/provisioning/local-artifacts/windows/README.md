# Windows Local Artifacts

Place Windows endpoint payloads here.

Example Koi resource wiring:

```ts
"koi": {
  "scriptPath": "local-artifacts/windows/koi.py",
  "arguments": [],
  "environment": {}
}
```

Example app profile installer wiring:

```ts
{
  "id": "example-agent",
  "name": "Example Agent",
  "method": "msi",
  "sourcePath": "local-artifacts/windows/example-agent.msi",
  "args": ["REBOOT=ReallySuppress"]
}
```
