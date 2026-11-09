# SitePass

**Decentralized verification and revocation of professional safety clearances for sensitive construction sites
(construction / nuclear), deployed on Base Sepolia.**

Accredited training organizations (Issuer A, Issuer B…) anchor workers' clearances on-chain. Any site guard can verify a
badge in a browser **without a wallet**: issuer, validity, revocation reason, expiry, and whether the worker's
PDF/JSON certificate is authentic. The worker proves that they control the badge by signing a challenge (no gas).
Only SHA-256 fingerprints reach the blockchain: no personal data.

> The chain proves that *an accredited issuer made a claim*. It does not prove the claim is true; that remains the
> issuer's responsibility.

---

## Table of contents

1. [Quick start (local)](#quick-start-local)
2. [Deploying on Base Sepolia](#deploying-on-base-sepolia)
3. [Scripts](#scripts)
4. [Architecture](#architecture)
5. [Roles and trust model](#roles-and-trust-model)
6. [Smart contracts](#smart-contracts)
7. [Off-chain document & privacy (GDPR)](#off-chain-document--privacy-gdpr)
8. [Issuer identity: DNS cross-check](#issuer-identity-dns-cross-check)
9. [Proof of control](#proof-of-control)
10. [Tests](#tests)
11. [How SitePass differs from EAS](#how-sitepass-differs-from-eas)
12. [Known limits](#known-limits)

The live defense script is in **[DEMO.md](./DEMO.md)**.

---

## Quick start (local)

Requirements: **Node.js ≥ 22.18** and **pnpm 10** (`corepack enable`, or `npm i -g pnpm@10`).

```bash
pnpm install
pnpm env:init      # creates .env from .env.example (nothing to fill for local dev)
pnpm dev           # local Hardhat chain + deploy + demo seed + web app
```

Open <http://localhost:5173>. `pnpm dev` runs three steps:

1. `pnpm chain`: Hardhat node on `127.0.0.1:8545` (chain id 31337), with a block every 2 s so that expiry is
   visible in free `view` calls.
2. `pnpm deploy:local`: deploys both contracts, registers 2 demo issuers, issues 4 demo credentials (valid,
   to-revoke, short expiry, already revoked), writes their certificates to `demo/localhost/`, and writes the
   addresses and ABIs into the web app.
3. `pnpm web:local`: Vite dev server targeting the local chain.

### Demo mode and production mode

The web app has two modes, chosen with `VITE_APP_MODE` in the root `.env`:

| | `demo` (default in `.env.example`) | `production` |
| --- | --- | --- |
| Navigation | Every page listed; pages your wallet cannot use show a lock | Only the pages of your role |
| Restricted pages | Stay open with a warning, so the contract rejection can be shown live | "Access restricted" screen |
| Demo console (`/demo`) | Personas, guided scenario, seeded credentials, sample and tampered certificates | Not available |
| Wallet | Browser wallet + **built-in persona wallet** on the local chain (one-click "Act as") | Browser wallet only |
| Demo affordances | "Try to transfer", "Revoke a credential by ID", seeded shortcuts on the verifier | Hidden |

Roles are read on-chain from the connected wallet: **visitor** (no wallet: verify, accredited issuers, public
worker pages), **worker** (any wallet: own credentials, proof of control), **issuer** (registered in the
`IssuerRegistry`: overview, issuance, revocation) and **registry admin** (registry owner: accreditation,
suspension). A demo build can switch to a *production preview* from the top banner or the demo console.

The built-in persona wallet signs locally with the public Hardhat keys below, so it only exists on chain 31337
and its keys are compiled out of `production` builds. The seed writes the demo fixtures used by the console to
`apps/web/src/config/demo-seed.json` (git-ignored).

### On phones (site gate)

The app is designed for two phones and no copy-paste, through QR codes and the camera:

1. **Verify**: the guard taps **Scan** (bottom bar) and scans the QR code the worker shows from *My credentials*.
   The verdict (valid / revoked / expired) comes first on screen.
2. **Prove it is theirs**: the guard taps *Ask the worker to prove it*; the worker scans that code with **Scan**,
   taps **Sign** (EIP-712, no gas) and shows the resulting code; the guard scans it back: *Identity proven*.

Every QR code is a link to the app, so a phone's native camera opens it too. Each scanner also has a manual entry,
and the proof step keeps a link fallback for devices without a camera.

To try it on a real phone with the local chain, run `pnpm dev:mobile` (or `pnpm web:mobile` if the contracts are
already deployed). Vite then listens on the LAN over HTTPS with a self-signed certificate (the camera requires a
secure context: accept the certificate warning once on the phone), and the phone reaches the Hardhat node through
the dev server's `/rpc` proxy. Open the `Network` URL printed by Vite.

To use MetaMask instead, import these well-known Hardhat test keys (local only, never use them on a real network):

| Role | Account | Private key |
| --- | --- | --- |
| Deployer / registry admin | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` |
| Issuer A | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d` |
| Issuer B | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` | `0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a` |
| Holder (worker) | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` | `0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6` |
| Attacker (not an issuer) | `0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65` | `0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a` |

The app adds the "Hardhat" network (31337, `http://127.0.0.1:8545`) to MetaMask when you click *Switch network*.
After restarting the chain, reset MetaMask's nonce cache: *Settings → Advanced → Clear activity tab data*.

---

## Deploying on Base Sepolia

```bash
pnpm env:keys              # generates deployer / issuer A / issuer B / holder wallets into .env
# fund the printed deployer address with Base Sepolia ETH (faucet)
pnpm deploy:base-sepolia   # deploy + register issuers + seed demo credentials
pnpm verify:base-sepolia   # optional: publish sources (Blockscout/Sourcify, Basescan with ETHERSCAN_API_KEY)
pnpm web:base-sepolia      # web app against Base Sepolia
```

Everything is driven by the root `.env`. See [`.env.example`](./.env.example) for the full list.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DEPLOYER_PRIVATE_KEY` | yes | Deploys, temporarily administers the registry, tops up issuers with gas |
| `ISSUER_A_PRIVATE_KEY`, `ISSUER_B_PRIVATE_KEY` | yes | Demo training organizations (sign the seed credentials) |
| `ISSUER_A_NAME/DOMAIN`, `ISSUER_B_NAME/DOMAIN` | no | Public name and reference domain registered for each issuer |
| `HOLDER_ADDRESS` (+ `HOLDER_PRIVATE_KEY` for MetaMask) | yes | Demo worker wallet |
| `REGISTRY_ADMIN_ADDRESS` | recommended | Safe multisig that receives registry ownership after seeding |
| `BASE_SEPOLIA_RPC_URL` | no | RPC for scripts (defaults to `https://sepolia.base.org`) |
| `VITE_NETWORK` | no | `localhost` or `baseSepolia`, network used by `pnpm web` |
| `VITE_APP_MODE` | no | `demo` or `production` (see [Demo mode and production mode](#demo-mode-and-production-mode)) |
| `VITE_BASE_SEPOLIA_RPC_URL` | no | Public RPC used by the browser |
| `VITE_ISSUER_REGISTRY_ADDRESS`, `VITE_SITE_CREDENTIAL_MANAGER_ADDRESS` | no | Override the deployed addresses |
| `ETHERSCAN_API_KEY` | no | Basescan verification (Etherscan API v2 key) |
| `SEED_DEMO_DATA`, `SEED_SHORT_EXPIRY_MINUTES` | no | Seeding options |

Deployment addresses are written to `packages/contracts/deployments/<network>.json` and
`apps/web/src/config/deployments.json` (keyed by chain id). Commit them so others can reuse the deployment.

**Handing over to a Safe.** If `REGISTRY_ADMIN_ADDRESS` is set, the deploy script calls `transferOwnership(safe)`
after seeding. Ownership is two-step: the Safe must execute `acceptOwnership()` on the `IssuerRegistry` (Safe
*Transaction Builder*, paste the registry address and ABI). Until then, the deployer remains the admin.

---

## Scripts

All commands run from the repository root.

| Command | What it does |
| --- | --- |
| `pnpm dev` | Local chain + deploy + seed + web app, all in one |
| `pnpm chain` | Start the local Hardhat chain only |
| `pnpm deploy:local` / `pnpm deploy:base-sepolia` | Deploy contracts, register issuers, seed demo data, export addresses & ABIs |
| `pnpm seed:local` / `pnpm seed:base-sepolia` | Issue a fresh set of demo credentials on an existing deployment |
| `pnpm demo:failures:local` / `pnpm demo:failures:base-sepolia` | Print the decoded revert reasons of the mandatory failure cases |
| `pnpm verify:base-sepolia` | Verify contract sources on the block explorer |
| `pnpm web` / `pnpm web:local` / `pnpm web:base-sepolia` | Vite dev server (network from `.env` / forced) |
| `pnpm dev:mobile` / `pnpm web:mobile` | Same as `pnpm dev` / `pnpm web:local`, exposed on the LAN over HTTPS for phones |
| `pnpm web:build` / `pnpm web:preview` | Production build of the static web app |
| `pnpm test` | Solidity unit tests + TypeScript integration tests |
| `pnpm coverage` | Same, with a Solidity coverage report |
| `pnpm compile` / `pnpm export:abi` | Compile contracts / regenerate the web app's typed ABIs |
| `pnpm typecheck` | Typecheck every package |
| `pnpm env:init` / `pnpm env:keys` | Create `.env` / generate Base Sepolia demo wallets |

---

## Architecture

```
.
├── packages/contracts       Hardhat 3 + viem
│   ├── contracts/           IssuerRegistry.sol, SiteCredentialManager.sol, interfaces/
│   ├── test/                *.t.sol (forge-std unit tests) + SitePass.integration.ts (node:test + viem)
│   ├── scripts/             deploy, seed, demo-failures, verify, export-abi, env setup, chain wrapper
│   └── deployments/         deployed addresses per network
├── packages/shared          Off-chain logic shared by scripts, tests and the web app
│   └── src/                 document format, SHA-256, credential id, EIP-712 proof, DNS-over-HTTPS check, catalogs
├── apps/web                 Vite + React 19 + Tailwind v4 + shadcn/ui + wagmi/viem
│   └── src/pages/           VerifierPage (/), HolderPage (/holder), ProvePage (/prove), IssuerPage (/issuer), RegistryPage (/registry)
└── demo/                    generated off-chain certificates (git-ignored: personal data)
```

```
             ┌──────────────────────┐   addIssuer / suspendIssuer      ┌──────────────────┐
             │   IssuerRegistry     │ ◄──────────────────────────────── │ Registry admin   │
             │  whitelist + name +  │                                   │ (Safe multisig)  │
             │  reference domain    │                                   └──────────────────┘
             └─────────▲────────────┘
                       │ isActiveIssuer / getIssuer
             ┌─────────┴────────────┐  issueCredential / revokeCredential  ┌──────────────────┐
             │ SiteCredentialManager│ ◄──────────────────────────────────── │ Issuer (wallet)  │
             │ attestations mapping │                                       └──────────────────┘
             └─────────▲────────────┘
                       │ verifyCredential / getCredentialsByHolder (eth_call, no wallet)
             ┌─────────┴────────────┐       EIP-712 challenge signature     ┌──────────────────┐
             │  Verifier (browser)  │ ◄──────────────────────────────────── │ Holder (wallet)  │
             │ + SHA-256 of the file│                                       └──────────────────┘
             │ + DNS TXT over DoH   │
             └──────────────────────┘
```

---

## Roles and trust model

| Role | Who | Can | Cannot | Trust assumption |
| --- | --- | --- | --- | --- |
| **Registry admin** | Safe multisig (site operator + safety authority + auditor) | Accredit, update, suspend, reinstate issuers; transfer admin (two-step) | Issue or revoke credentials; renounce admin; delete an issuer | **Root of trust of the whole system.** Whoever controls it decides who may issue. A single key here is a single point of failure, so it must be a multisig. |
| **Issuer** | Accredited training organization | Issue credentials; revoke *its own* credentials with a reason | Revoke another issuer's credentials; transfer credentials; edit a credential | Truthfulness of the training claim. Its address is cross-checked through DNS. |
| **Holder** | Worker | Show badges; prove control of the wallet by signing a challenge | Transfer, lend or sell a badge; revoke | Keeps their private key safe. |
| **Verifier** | Site guard / site manager | Read everything for free, check document authenticity, request a proof of control | Anything that changes state (needs no account at all) | Uses an honest RPC endpoint (can cross-check with a second one). |
| **Deployer** | Whoever runs the deploy script | Temporarily administers the registry to seed issuers, then hands it to the Safe | Nothing after hand-over: `SiteCredentialManager` has no owner and no upgrade path | Executes the hand-over (visible on-chain: `OwnershipTransferStarted`). |

What happens if a channel is compromised:

- **Registry admin key compromised**: the attacker can accredit a fake issuer. Mitigations: multisig, public
  `IssuerAdded` events that anyone can monitor, and the DNS check (a fake issuer cannot publish a TXT record on
  `issuer-a.example`).
- **Issuer key compromised**: the admin suspends the issuer. Its credentials immediately show `ISSUER_SUSPENDED`
  (fail-closed), the suspended issuer can still revoke them one by one, and the admin can later reinstate it.
- **Issuer domain/DNS compromised**: the registry still holds the accredited address; the verifier sees a
  *DNS mismatch* warning instead of a green check. Both channels must be compromised to impersonate an issuer.

---

## Smart contracts

Solidity 0.8.28, OpenZeppelin 5, no token standard, no proxy.

### `IssuerRegistry`

- `addIssuer(address, name, domain)`, `updateIssuer`, `suspendIssuer`, `reinstateIssuer`: `onlyOwner`.
- `isActiveIssuer(address)`, `getIssuer(address)`, `getIssuerAccounts()`, `issuerCount()`.
- `Ownable2Step` (pending admin must `acceptOwnership()`), `renounceOwnership()` disabled.
- Issuers are suspended, never deleted, so historical credentials keep showing who issued them.

### `SiteCredentialManager`

| Function | Access | Notes |
| --- | --- | --- |
| `issueCredential(holder, credentialType, documentHash, expiresAt)` | active issuers only | `credentialType` = ASCII code as `bytes32` (e.g. `NUC-PR1-CC`), `documentHash` = SHA-256 of the certificate, `expiresAt` = 0 for no expiry. Returns a deterministic id. |
| `revokeCredential(id, reasonCode)` | **original issuer only** | `1 SAFETY_BREACH`, `2 MEDICAL_UNFIT`, `3 EXPIRED_EARLY`, `4 FRAUDULENT_ISSUANCE`. Stores date and reason, never deletes. |
| `verifyCredential(id)` | public `view` | Full state in one call: `exists`, `isValid`, `status`, issuer + name + domain + active flag, holder, type, hash, dates, expiry, revocation. |
| `verifyCredentials(ids[])` | public `view` | Batch version (works without Multicall3, e.g. on a local node). |
| `getCredentialsByHolder(holder)` / `getCredentialsByIssuer(issuer)` / `getCredentialsByDocumentHash(hash)` | public `view` | Enumeration for the holder page, issuer dashboard and document lookup. |
| `computeCredentialId(issuer, documentHash)` | public `view` | `keccak256(abi.encode(chainid, this, issuer, documentHash))`, mirrored off-chain. |
| `transferCredential(id, to)` | public `view` | **Always reverts** with `CredentialNonTransferable(id)`. It exists only to give transfer attempts a readable error. |

Status priority: `UNKNOWN` › `REVOKED` › `EXPIRED` › `ISSUER_SUSPENDED` › `VALID`.

Every failure is a custom error (`NotAuthorizedIssuer`, `NotCredentialIssuer`, `CredentialNonTransferable`,
`InvalidRevocationReason`…). The web app decodes it into a readable message.

**Why not ERC-721 / soulbound?** A token brings balances, owners, approvals and transfer hooks that then have to be
disabled one by one, and one forgotten path makes a badge transferable. A plain mapping of attestations has no
transfer surface at all: `holder` is written once at issuance and no code path can change it. The tests check that
every ERC-721 selector (`transferFrom`, `safeTransferFrom`, `approve`, `setApprovalForAll`, `ownerOf`) reverts.

---

## Off-chain document & privacy (GDPR)

On-chain: holder address (pseudonymous), clearance code, timestamps, SHA-256 fingerprint, issuer address. **No
name, birth date, score or employer**, neither in storage, calldata nor events (enforced by an integration test).

Off-chain certificate, format `sitepass.credential.v1` (aligned on the W3C VC Data Model 2.0 vocabulary, `did:pkh`
identifiers):

```json
{
  "@context": ["https://www.w3.org/ns/credentials/v2"],
  "type": ["VerifiableCredential", "SitePassSafetyCredential"],
  "schemaVersion": "sitepass.credential.v1",
  "issuer": { "id": "did:pkh:eip155:84532:0x…", "address": "0x…", "name": "Issuer A", "domain": "issuer-a.example" },
  "validFrom": "2026-10-16T09:00:00.000Z",
  "validUntil": "2029-10-15T21:59:59.000Z",
  "credentialSubject": {
    "id": "did:pkh:eip155:84532:0x…", "address": "0x…",
    "firstName": "Worker", "lastName": "Test", "birthDate": "1990-01-01", "employer": "…",
    "clearance": { "code": "NUC-PR1-CC", "label": "Radiation Protection - Level 1 (PR1-CC)", "category": "nuclear" },
    "training": { "sessionReference": "S-2026-001", "location": "…", "completedOn": "2026-10-01", "result": "Passed" }
  },
  "anchor": { "chainId": 84532, "contract": "0x…" },
  "salt": "0x<32 random bytes>"
}
```

- **Hashing rule**: `documentHash = SHA-256(exact bytes of the file)`. The issuer serializes with 2-space JSON plus a
  trailing newline and hands over that exact file. The verifier hashes the raw bytes of whatever is dropped (JSON or
  PDF), so any modification breaks the match.
- **Salt**: a small, guessable document (name + birth date + type) could be brute-forced from its hash. The 256-bit
  random salt makes that impossible.
- **Right to erasure**: the certificate is the only copy of the personal data. Destroying it leaves an on-chain
  hash that can no longer be linked to anyone. The holder address remains a pseudonymous identifier; a worker can
  use a dedicated wallet for SitePass.

---

## Issuer identity: DNS cross-check

The registry says *"the admin accredited this address as Issuer A, domain issuer-a.example"*. The verifier cross-checks it
through an independent channel: the organization publishes

```
_sitepass.issuer-a.example.  TXT  "sitepass-issuer=0xIssuerAddress"
```

and the browser queries it over DNS-over-HTTPS (Cloudflare, then Google). Result badges: **DNS verified** /
**DNS mismatch** / **No DNS proof** / **DNS unreachable**. The registry page shows the exact record to publish
for each issuer (copy button).

The demo issuers default to `issuer-a.example` / `issuer-b.example` (reserved, unresolvable domains), which do not publish this record. That is a good way to
show "No DNS proof" (the *"assuming the issuer address is the school's"* trap). To show a green check, set
`ISSUER_A_DOMAIN` to a domain you control and add the TXT record before deploying.

---

## Proof of control

A valid badge only proves that *some wallet* holds a clearance. At the gate:

1. The verifier clicks **Generate challenge**: random 32-byte nonce, credential id, expected holder, checkpoint
   label, 5-minute lifetime, shown as a QR code / link.
2. The worker opens it (`/prove?c=…`), connects their wallet and signs **EIP-712 typed data**
   (`ProofOfControl`, domain `SitePass v1` bound to the chain id and the manager contract). No transaction, no gas.
3. The verifier recovers the signer and checks: same address as the on-chain holder, same nonce, not expired.
   On the same browser the signature arrives automatically (BroadcastChannel); otherwise it is pasted/scanned.

---

## Tests

```bash
pnpm test        # 48 Solidity tests (incl. fuzzing) + 6 TypeScript integration tests
pnpm coverage    # 100 % line & statement coverage on both contracts
```

| Required scenario | Tests |
| --- | --- |
| 1. Valid issuance by an accredited issuer | `test_Scenario1_*` (fields, event, indexes, deterministic id) |
| 2. Issuance by an unregistered address reverts | `test_Scenario2_*` incl. registry admin, suspended issuer, fuzzed callers |
| 3. Valid revocation by the original issuer | `test_Scenario3_*` (reason, date, data preserved, all reason codes, suspended issuer) |
| 4. Revocation by another issuer / attacker reverts | `test_Scenario4_*` incl. admin, holder, fuzzed callers |
| 5. No transfer primitive | `test_Scenario5_*` (`transferCredential` reverts, ERC-721 selectors absent, ETH rejected) |
| 6. Expiration computation | `test_Scenario6_*` (exact boundary, no expiry, past expiry rejected, revoked > expired, fuzzed) |

The integration test (`test/SitePass.integration.ts`) runs the full off-chain flow: document → SHA-256 →
issuance → wallet-less verification → EIP-712 proof (valid, wrong signer, expired) → revocation → readable
custom errors. It also checks that no personal data appears in calldata or logs.

---

## How SitePass differs from EAS

| | EAS | SitePass |
| --- | --- | --- |
| Scope | Generic attestation protocol, any schema, anyone can attest | Domain-specific: safety clearances, fixed fields |
| Who can attest | Anyone (trust is decided off-chain by the consumer) | Only issuers whitelisted in an on-chain registry governed by a multisig |
| Revocation | Attester revokes, no reason | Original issuer only, **mandatory reason code** + timestamp |
| Status | Consumer recomputes validity | `verifyCredential` returns a ready-to-display status, including issuer suspension |
| Identity of attester | Address only | Registry name + reference domain + DNS TXT cross-check |
| Data | Arbitrary encoded data | Hash of a salted off-chain document only (privacy by design) |
| Enumeration | Off-chain indexers | On-chain lists by holder, issuer and document hash |

---

## Known limits

- The registry admin remains a trusted party (mitigated by multisig + public events + DNS).
- On-chain enumeration arrays grow forever. That is fine for a pilot; at scale, use an indexer (e.g. a subgraph on
  `CredentialIssued` / `CredentialRevoked`).
- The proof-of-control check uses `ecrecover` (EOA wallets). Smart-contract wallets would need ERC-1271.
- The DNS check trusts the DoH resolver; DNSSEC validation is out of scope.
