# Agent Note: Production-region DigitalOcean inference routes

Status: implemented

## Problem

The public DigitalOcean inference route is one hostname, `https://inference.do-ai.run/v1`. A request through it is not pinned to a serving cluster. Production inference also answers on one in-cluster Traefik host per region (`atl1`, `ric1`, `tor1`). Those hosts require a staff client certificate during TLS, and then the same model access key the public edge accepts. The proxy is not a DOCC app and is not in EDS, so the hostname is the discovery record.

## Decision

`digitalocean` stays the public edge at `https://inference.do-ai.run/v1` with `DO_INFERENCE_API_KEY` and no client certificate. Three additional shipped routes, `internal_digital_ocean_atl1`, `internal_digital_ocean_ric1`, and `internal_digital_ocean_tor1`, use the same wire compatibility and effort menu and pin `https://inference-serving-production-<region>.traefik.gen-ai.cloud-infra.dointernal.com/v1`. The base composition names those routes with the same credential reference plus `clientCert: ~/.ssh/staff.crt` and `clientKey: ~/.ssh/staff.key`. Preview hosts are not routes. A profile that sets only one of the certificate paths is refused when it resolves. Model requests and model listing use a fetch that presents the pair; the files are reread after either mtime changes. A request stays on the cluster that host fronts.

## Alternatives considered

**Retarget `digitalocean` at a regional host.** That would change the public route every deployment already selects. The regional hosts are separate routes so the public endpoint is unchanged.

**Put the hostnames only in user settings.** The endpoints are vendor facts, same as the public edge, so they live in the shipped catalog. The certificate paths are deployment configuration, so they live on the composition profile next to `apiKeyEnv`.

## Consequences

A process whose home directory has no staff certificate still serves `digitalocean`. The regional routes log a live-catalog failure until both PEM files can be read, and a model call on them fails with `INVALID_CONFIG` naming the paths. The key must be valid for production; a preview key is an invalid model api key from the proxy, not a TLS failure. These routes are not sign-in records: pi-ai does not install them, and the ids are not credential-record segments.
