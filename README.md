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

Roles are read on-chain from the connected wallet: **visitor** (no wallet: verify, accredited organizations,
federation governance, public worker pages), **worker** (any wallet: own credentials, proof of control),
**issuing member** of an organization (overview, issuance, revocation) and **organization admin** (its internal
multisig and its federation votes). There is no registry admin. A demo build can switch to a *production preview*
from the top banner or the demo console.

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

| # | Role | Account | Private key |
| --- | --- | --- | --- |
| 0 | Deployer (no role after deployment) | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` |
| 1 | Trainer A (issuing member of A) | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d` |
| 2 | Trainer B (issuing member of B) | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` | `0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a` |
| 3 | Holder (worker) | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` | `0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6` |
| 4 | Attacker (no role) | `0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65` | `0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a` |
| 5 | Admin A1 (A is 2-of-2) | `0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc` | `0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba` |
| 6 | Admin A2 | `0x976EA74026E726554dB657fA54763abd0C3a0aa9` | `0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e` |
| 7 | Admin B (B is 1-of-1) | `0x14dC79964da2C08b23698B3D3cc7Ca32193d9955` | `0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356` |
| 8 | Trainer A2 (second member of A) | `0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f` | `0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97` |
| 9 | Admin C (candidate organization) | `0xa0Ee7A142d267C1f36714E4a8F75612F20a79720` | `0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6` |

The app adds the "Hardhat" network (31337, `http://127.0.0.1:8545`) to MetaMask when you click *Switch network*.
After restarting the chain, reset MetaMask's nonce cache: *Settings → Advanced → Clear activity tab data*.

---

## Deploying on Base Sepolia

```bash
pnpm env:keys              # generates the deployer, the people of organizations A and B, admin C and the holder
# fund the printed deployer address with Base Sepolia ETH (faucet)
pnpm deploy:base-sepolia   # deploy the federation (founding organizations A and B) + seed demo credentials
pnpm verify:base-sepolia   # optional: publish sources (Blockscout/Sourcify, Basescan with ETHERSCAN_API_KEY)
pnpm web:base-sepolia      # web app against Base Sepolia
```

Everything is driven by the root `.env`. See [`.env.example`](./.env.example) for the full list.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DEPLOYER_PRIVATE_KEY` | yes | Deploys and tops up the demo people with gas. Holds **no role** afterwards |
| `ADMIN_A1_PRIVATE_KEY`, `ADMIN_A2_PRIVATE_KEY` | A1 yes, A2 no | Admins of founding organization A (2-of-2, or 1-of-1 without A2) |
| `ISSUER_A_PRIVATE_KEY`, `ISSUER_A2_PRIVATE_KEY` | A yes, A2 no | Trainers (issuing members) of A; trainer A signs the seed credentials |
| `ADMIN_B_PRIVATE_KEY`, `ISSUER_B_PRIVATE_KEY` | yes | Admin (1-of-1) and trainer of founding organization B |
| `ADMIN_C_PRIVATE_KEY` | no | Admin of a candidate organization, admitted by vote during the demo |
| `ISSUER_A_NAME/DOMAIN`, `ISSUER_B_NAME/DOMAIN` | no | Public name and reference domain of each founding organization |
| `HOLDER_ADDRESS` (+ `HOLDER_PRIVATE_KEY` for MetaMask) | yes | Demo worker wallet |
| `GOVERNANCE_PROPOSAL_LIFETIME`, `GOVERNANCE_TIMELOCK_DELAY` | no | Seconds. Defaults: 7 days / 2 days (local chain: 1 day / 60 s) |
| `BASE_SEPOLIA_RPC_URL` | no | RPC for scripts (defaults to `https://sepolia.base.org`) |
| `VITE_NETWORK` | no | `localhost` or `baseSepolia`, network used by `pnpm web` |
| `VITE_APP_MODE` | no | `demo` or `production` (see [Demo mode and production mode](#demo-mode-and-production-mode)) |
| `VITE_BASE_SEPOLIA_RPC_URL` | no | Public RPC used by the browser |
| `VITE_ISSUER_REGISTRY_ADDRESS`, `VITE_SITE_CREDENTIAL_MANAGER_ADDRESS` | no | Override the deployed addresses |
| `ETHERSCAN_API_KEY` | no | Basescan verification (Etherscan API v2 key) |
| `SEED_DEMO_DATA`, `SEED_SHORT_EXPIRY_MINUTES` | no | Seeding options |

Deployment addresses are written to `packages/contracts/deployments/<network>.json` and
`apps/web/src/config/deployments.json` (keyed by chain id). Commit them so others can reuse the deployment.

**No hand-over.** The `IssuerRegistry` constructor creates and admits the founding organizations (one
`Organization` multisig contract each, with its admins and trainers). The deployer is never an admin, so there is
nothing to transfer: from the first block, only the organizations can change who may issue. The deploy script
prints the DNS record each organization should publish.

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
│   ├── contracts/           IssuerRegistry.sol, Organization.sol, SiteCredentialManager.sol, interfaces/
│   ├── test/                *.t.sol (forge-std unit tests) + SitePass.integration.ts (node:test + viem)
│   ├── scripts/             deploy, seed, demo-failures, verify, export-abi, env setup, chain wrapper
│   └── deployments/         deployed addresses per network
├── packages/shared          Off-chain logic shared by scripts, tests and the web app
│   └── src/                 document format, SHA-256, credential id, EIP-712 proof, DNS-over-HTTPS check, catalogs
├── apps/web                 Vite + React 19 + Tailwind v4 + shadcn/ui + wagmi/viem
│   └── src/pages/           VerifierPage (/), HolderPage (/wallet), ProvePage (/prove), IssuerPage (/issuer),
│                            OrganizationPage (/organization), RegistryPage (/issuers, /governance), DemoPage (/demo)
└── demo/                    generated off-chain certificates (git-ignored: personal data)
```

```
                                    propose (admins)       ┌──────────────────────────────┐
             ┌──────────────────────┐ ◄──────────────────── │ Organization A (contract)    │
             │   IssuerRegistry     │   approve = org vote   │  admins: M-of-N multisig ◄── people
             │  federation, NO owner│ ◄──────────────────── │  members: trainers       ◄── people
             │  quorum · timelock · │                        └──────────────────────────────┘
             │  expiry · 1 org/person│ ◄──── Organization B, C… (same shape)
             └─────────▲────────────┘
                       │ issuingOrganizationOf / isMemberOf / getOrganization
             ┌─────────┴────────────┐  issueCredential / revokeCredential  ┌──────────────────┐
             │ SiteCredentialManager│ ◄──────────────────────────────────── │ Trainer (person) │
             │ attestations mapping │   issuer = organization, signer = trainer └──────────────┘
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
| **Federation** | The accredited organizations, collectively (no admin account exists) | By vote: admit, update, suspend, reinstate an organization; change the quorum | Issue or revoke credentials; act without a quorum; skip the timelock (except suspension); suspend the last active organization | **Root of trust of the whole system**, spread over the organizations: a decision needs strictly more than the quorum of them (strict majority by default). |
| **Organization** | A training organization, as an `Organization` contract: its address is its identity | Vote in the federation (through its multisig); add/remove its own people | Vote on its own suspension; change another organization | Truthfulness of the training claims of its members. Its contract address is cross-checked through DNS. |
| **Organization admin** | A person (wallet) of the organization | Propose and approve the organization's decisions: people, threshold, federation votes | Act alone (M-of-N threshold); issue (unless also a member); belong to two organizations | A single admin key is never enough when the threshold is above 1. |
| **Trainer (issuing member)** | A person (wallet) of the organization | Issue credentials for the organization; revoke **any** credential of the organization with a reason | Revoke another organization's credentials; transfer or edit a credential; issue once removed or while the organization is suspended | Keeps their key safe; can be removed at once by the admins. |
| **Holder** | Worker | Show badges; prove control of the wallet by signing a challenge | Transfer, lend or sell a badge; revoke | Keeps their private key safe. |
| **Verifier** | Site guard / site manager | Read everything for free, check document authenticity, request a proof of control | Anything that changes state (needs no account at all) | Uses an honest RPC endpoint (can cross-check with a second one). |
| **Deployer** | Whoever runs the deploy script | Chooses the founding organizations (constructor arguments, public and verifiable) | Anything once deployed: no contract has an owner or an upgrade path | None after deployment. |

What happens if a channel is compromised:

- **A trainer's key is stolen (or the trainer leaves)**: the admins of the organization remove them; removal runs as
  soon as the threshold is reached (no timelock). Their past credentials stay valid (they belong to the
  organization) and any other trainer can revoke the suspicious ones.
- **An admin's key is stolen**: with a threshold above 1 it cannot act alone; the other admins remove it.
- **A whole organization is compromised**: the other organizations suspend it by vote, immediately. Its credentials
  show `ISSUER_SUSPENDED` (fail-closed), its members can still revoke them, and it can be reinstated by vote later.
- **A majority of organizations colludes**: they could admit a fake organization, but only after the public
  timelock (events `ProposalCreated` / `ProposalReady` that anyone can monitor), and the fake organization would
  still fail the DNS check on the domain it claims.
- **An organization's domain/DNS is compromised**: the registry still holds the accredited contract; the verifier
  sees a *DNS mismatch* warning instead of a green check. Both channels must be compromised to impersonate an issuer.

---

## Smart contracts

Solidity 0.8.28, no token standard, no proxy, **no owner anywhere**.

### `IssuerRegistry` (the federation)

- `constructor(proposalLifetime, timelockDelay, quorumBps, founders[])`: creates and admits the founding
  organizations. The deployer gets no role.
- `createOrganization(name, domain, admins[], threshold, members[])`: anyone; deploys an `Organization` in
  `PENDING` state (the registry is the factory, so it can trust the organizations' hooks).
- Proposals, opened by an admin of an `ACTIVE` organization (or, for its own admission, by an admin of the pending
  candidate): `proposeAdmission`, `proposeUpdate(org, name, domain)`, `proposeSuspension`, `proposeReinstatement`,
  `proposeQuorum(bps)`.
- `approve(id)` / `revokeApproval(id)`: called **by an `Organization` contract** once its own admins reached their
  threshold. `execute(id)`: anyone.
- Rules: passes with strictly more than `quorumBps` / 10 000 of the eligible organizations (5 000 = strict majority,
  10 000 = unanimity; changeable by vote, never below 5 000). Votes are counted at execution time (votes of
  organizations suspended meanwhile drop). An organization never votes on its own suspension, and the last active
  organization cannot be suspended. Every proposal expires after `proposalLifetime`; everything except suspension
  waits `timelockDelay` after reaching the quorum.
- One organization per person: `organizationOf(account)` is bound when the organization is admitted and kept in
  sync by its hooks.
- Reads used by the manager: `issuingOrganizationOf(account)`, `isMemberOf(account, org)`, `getOrganization(org)`.
- Organizations are suspended, never deleted, so historical credentials keep showing who issued them.

### `Organization` (one per training organization)

- Its **address is the organization's identity** (registry, DNS record, credentials); it never changes when people do.
- Admins (≤ 20) with an M-of-N `threshold`, issuing members (≤ 200). A person may hold both roles.
- `propose(action, account, value)` (auto-approved by the proposer), `approve`, `revokeApproval`, `execute`.
  Actions: add/remove member, add/remove admin, set threshold, approve/withdraw a federation proposal.
- Adding people and changing the threshold wait for the timelock; removals and federation votes run as soon as the
  threshold is reached. Approvals of removed admins stop counting. Proposals expire.
- `leave()`: anyone can drop their own roles (e.g. added without consent), unless it would make the threshold
  unreachable.

### `SiteCredentialManager`

| Function | Access | Notes |
| --- | --- | --- |
| `issueCredential(holder, credentialType, documentHash, expiresAt)` | members of an **active** organization | Issued by the organization (`issuer` = its contract), signed by the member (`signer`). `credentialType` = ASCII code as `bytes32` (e.g. `NUC-PR1-CC`), `documentHash` = SHA-256 of the certificate, `expiresAt` = 0 for no expiry. Returns a deterministic id. |
| `revokeCredential(id, reasonCode)` | **current members of the issuing organization** (even if suspended) | `1 SAFETY_BREACH`, `2 MEDICAL_UNFIT`, `3 EXPIRED_EARLY`, `4 FRAUDULENT_ISSUANCE`. Stores date, reason and `revokedBy`, never deletes. |
| `verifyCredential(id)` | public `view` | Full state in one call: `exists`, `isValid`, `status`, issuer organization + name + domain + active flag, signer, holder, type, hash, dates, expiry, revocation. |
| `verifyCredentials(ids[])` | public `view` | Batch version (works without Multicall3, e.g. on a local node). |
| `getCredentialsByHolder` / `getCredentialsByIssuer(org)` / `getCredentialsBySigner(person)` / `getCredentialsByDocumentHash` | public `view` | Enumeration for the holder page, organization dashboard and document lookup. |
| `computeCredentialId(issuer, documentHash)` | public `view` | `keccak256(abi.encode(chainid, this, organization, documentHash))`, mirrored off-chain. |
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

The registry says *"the federation accredited this organization contract as Issuer A, domain issuer-a.example"*.
The verifier cross-checks it through an independent channel: the organization publishes

```
_sitepass.issuer-a.example.  TXT  "sitepass-issuer=0xOrganizationContract"
```

and the browser queries it over DNS-over-HTTPS (Cloudflare, then Google). Result badges: **DNS verified** /
**DNS mismatch** / **No DNS proof** / **DNS unreachable**. The *Accredited organizations* page shows the exact record
to publish for each organization (copy button), and the deploy script prints it.

The record points to the organization's **contract**, not to a person: it is published once and stays valid when
trainers and admins change.

The demo organizations default to `issuer-a.example` / `issuer-b.example` (reserved, unresolvable domains), which do
not publish this record. That is a good way to show "No DNS proof" (the *"assuming the issuer address is the
school's"* trap). To show a green check, set `ISSUER_A_DOMAIN` to a domain you control, deploy, then publish the
record printed by the deploy script.

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
pnpm test        # 93 Solidity tests (incl. fuzzing) + 7 TypeScript integration tests
pnpm coverage    # 100 % line & statement coverage on the three contracts
```

| Required scenario | Tests |
| --- | --- |
| 1. Valid issuance by a member of an accredited organization | `test_Scenario1_*` (fields, event, indexes, deterministic id, newly added member) |
| 2. Issuance by anyone else reverts | `test_Scenario2_*` incl. organization admin, organization contract, suspended / pending organization, removed member, fuzzed callers |
| 3. Valid revocation by the issuing organization | `test_Scenario3_*` (reason, date, data preserved, any member, signer gone, all reason codes, suspended organization) |
| 4. Revocation by another organization / attacker reverts | `test_Scenario4_*` incl. admin, holder, former member, fuzzed callers |
| 5. No transfer primitive | `test_Scenario5_*` (`transferCredential` reverts, ERC-721 selectors absent, ETH rejected) |
| 6. Expiration computation | `test_Scenario6_*` (exact boundary, no expiry, past expiry rejected, revoked > expired, fuzzed) |

The integration test (`test/SitePass.integration.ts`) runs the full off-chain flow: document → SHA-256 →
issuance → wallet-less verification → EIP-712 proof (valid, wrong signer, expired) → revocation → readable
custom errors, then the governance flow (no admin, suspension by a 2-of-2 organization vote, admission after the
timelock). It also checks that no personal data appears in calldata or logs.

Governance is covered by `test/IssuerRegistry.t.sol` (founders, the deployer has no power, admission, quorum, fuzzed
quorum, timelock, expiry, suspension rules, one organization per person) and `test/Organization.t.sol` (M-of-N
threshold, timelocked vs immediate actions, removed admins' approvals, leaving, caps, federation votes).

---

## How SitePass differs from EAS

| | EAS | SitePass |
| --- | --- | --- |
| Scope | Generic attestation protocol, any schema, anyone can attest | Domain-specific: safety clearances, fixed fields |
| Who can attest | Anyone (trust is decided off-chain by the consumer) | Only members of organizations admitted by an on-chain federation that governs itself (no admin) |
| Revocation | Attester revokes, no reason | Any member of the issuing organization, **mandatory reason code** + timestamp + revoker |
| Status | Consumer recomputes validity | `verifyCredential` returns a ready-to-display status, including issuer suspension |
| Identity of attester | Address only | Registry name + reference domain + DNS TXT cross-check |
| Data | Arbitrary encoded data | Hash of a salted off-chain document only (privacy by design) |
| Enumeration | Off-chain indexers | On-chain lists by holder, issuer and document hash |

---

## Known limits

- Trust is spread over the organizations: a colluding quorum of them can still admit a fake organization (mitigated
  by the timelock, public events and the DNS check). The founding set is chosen at deployment.
- A pending organization is created by anyone; its people are bound (one organization per person) only on admission.
  A person added to an admitted organization without consent can leave with `leave()`.
- Votes are counted on-chain with loops over the organizations and admins: fine for tens of organizations (admins are
  capped at 20, members at 200 per organization), not for thousands.
- `IssuerRegistry` embeds the `Organization` bytecode (it is the factory) and weighs ~22.6 KB of the 24 KB limit:
  a new feature there would require a separate factory contract.
- On-chain enumeration arrays grow forever. That is fine for a pilot; at scale, use an indexer (e.g. a subgraph on
  `CredentialIssued` / `CredentialRevoked`).
- The proof-of-control check uses `ecrecover` (EOA wallets). Smart-contract wallets would need ERC-1271.
- The DNS check trusts the DoH resolver; DNSSEC validation is out of scope.
