# SitePass - Defense demo script

Duration: about 12 minutes. Three profiles on **Base Sepolia**: **issuer**, **holder**, and **verifier without a
wallet**. The same script works on the local chain (`pnpm dev`) as a fallback if the testnet or the Wi-Fi fails.

---

## 0. Preparation (the day before)

### 0.1 Wallets and deployment

```bash
pnpm install
pnpm env:init
pnpm env:keys                 # generates DEPLOYER / ISSUER_A / ISSUER_B / HOLDER wallets in .env
```

1. Fund the **deployer** address printed by `pnpm env:keys` with ~0.02 Base Sepolia ETH (faucet). The deploy script
   tops up both issuers with gas.
2. *(Recommended)* Create a Safe on Base Sepolia (<https://app.safe.global>) and set `REGISTRY_ADMIN_ADDRESS`.
3. *(Optional, for a green DNS check)* Set `ISSUER_A_DOMAIN` to a domain you control and publish
   `_sitepass.<domain> TXT "sitepass-issuer=<ISSUER_A address>"`. Leave `ISSUER_B_DOMAIN=dekra.com` to show the
   "No DNS proof" case.
4. Set `SEED_SHORT_EXPIRY_MINUTES=5` (the expired demo badge) and `VITE_NETWORK=baseSepolia`.

```bash
pnpm deploy:base-sepolia      # deploy + register issuers + seed 4 demo credentials
pnpm verify:base-sepolia      # publish sources on the explorer
pnpm test                     # keep the green output in a terminal tab
```

If a Safe was configured: in the Safe, *New transaction → Transaction Builder*, target the `IssuerRegistry`
address, call `acceptOwnership()`, sign and execute.

### 0.2 Fill in the addresses

Copy them from `packages/contracts/deployments/baseSepolia.json` and `demo/baseSepolia/seed-summary.json`:

| Item | Value |
| --- | --- |
| `IssuerRegistry` | `0x…` |
| `SiteCredentialManager` | `0x…` |
| Registry admin (Safe) | `0x…` |
| Issuer A (Apave demo) | `0x…` |
| Issuer B (Dekra demo) | `0x…` |
| Holder (worker) | `0x…` |
| Credential `valid-nuclear` (NUC-PR1-CC) | `0x…` |
| Credential `to-revoke-live` (ELEC-B2V) | `0x…` |
| Credential `short-expiry` (BTP-WORK-AT-HEIGHT) | `0x…` |
| Credential `already-revoked` (HAZ-ATEX-1) | `0x…` |

The matching certificates are in `demo/baseSepolia/*.json`.

### 0.3 Browser setup

- **Window 1 (verifier)**: a **private window with no wallet extension**. This proves the "no wallet" constraint.
- **Window 2 (issuer / holder)**: normal window with MetaMask, holding three imported accounts: Issuer A, Issuer B,
  Holder (keys from `.env`).
- Tabs: Basescan on the `SiteCredentialManager` address (*Events* tab).
- Terminal: `pnpm web:base-sepolia` running (or the static build deployed anywhere).

---

> **Shortcut.** Run the web app with `VITE_APP_MODE=demo`: the **Demo console** (`/demo`) lists the personas,
> this scenario step by step, the seeded credentials and their authentic / tampered certificates. On the local
> chain, the top-bar **Act as** menu switches persona in one click without MetaMask. The mode badge
> "Preview production" shows the role-based experience (only the pages of the connected wallet's role).

---

## 1. Context and architecture (1 min)

- Problem: forged or outdated safety clearances on nuclear / construction sites; calling the training organization
  is slow and impossible at night.
- Two contracts: `IssuerRegistry` (whitelist governed by a multisig), `SiteCredentialManager` (attestations
  mapping, no token).
- Show the **Accredited issuers** page (public): admin = Safe, the two
  issuers with their domains and DNS badges.

---

## 2. Issuance; the event on the explorer (2 min)

*Window 2, MetaMask on **Issuer A**, page **Issue a credential** (`/issuer/new`).*

1. The header card shows "Apave Formation (demo) · Accredited" and its DNS status.
2. Fill in the form: holder = Holder address, name `Jean Dupont`, birth date, clearance
   **Radiation Protection - Level 1 (PR1-CC)**, expiry in 3 years.
3. Point out the right panel: the JSON certificate (with its random **salt**) and its **SHA-256**, both computed
   locally. Only the hash goes on-chain.
4. **Issue credential** → sign → toast "Credential issued". The certificate file downloads automatically.
5. Click **View event on explorer** → Basescan shows `CredentialIssued(id, issuer, holder, credentialType,
   documentHash, issuedAt, expiresAt)`. Point out that **no name or birth date** appears anywhere in the
   transaction (input data / logs).
6. Copy the credential ID.

---

## 3. Verification without a wallet (2 min)

*Window 1, private window, no extension.*

1. Open the app. The **Verify a credential** page is marked "No wallet needed"; all reads go
   through the public Base Sepolia RPC with free `eth_call`.
2. Paste the credential ID → **Valid** (green check icon): clearance, issuer name + domain + DNS badge, holder, issue date,
   validity window, on-chain SHA-256.
3. **Drag and drop** the downloaded JSON → "Document authentic - SHA-256 matches", with identity from the document
   (to compare with the worker's ID card) and consistency checks (holder, issuer, type, expiry, contract).
4. Open the JSON in an editor, change one letter of the name, save, drop it again → **Document does NOT match**.
5. Search by **holder address** → the list of all the worker's credentials: valid, already revoked
   (MEDICAL_UNFIT), expired (`short-expiry`, expired a few minutes after seeding).
6. Drop `demo/baseSepolia/4-already-revoked-*.json` without typing anything: the credential is found from the
   document alone (`getCredentialsByDocumentHash`).

---

## 4. Proof of control by the holder (2 min)

> On two phones (`pnpm dev:mobile`), this whole step is done with the **Scan** button and no link: the worker
> scans the guard's code, signs, and shows a code that the guard scans back.

*Window 1 (verifier) on the result of the new credential.*

1. **Prove the worker controls this badge** → label `Gate 3 - Flamanville` → **Generate challenge**: QR code, link,
   5-minute countdown.
2. Copy the link → *Window 2*, switch MetaMask to **Holder** → open the link (`/prove?c=…`).
3. The page shows the site, badge and nonce → **Sign the challenge** → MetaMask shows the EIP-712 message
   (no gas, no transaction).
4. Copy the signature → paste it in window 1 → **Verify signature** → "Identity proven".
   *(If both pages are in the same browser profile, the signature arrives by itself.)*
5. **Counter-example**: generate a new challenge, sign it with **Issuer B's** account → "Proof rejected (wrong
   signer)".
6. Show the holder's credentials (`/wallet`, or the shareable public page `/holder/<address>`) and a "Show to
   verifier" QR code per badge.

---

## 5. Live revocation (2 min)

*Window 2, MetaMask on **Issuer A**, page **Overview** (`/issuer`).*

1. Find `ELEC-B2V` (`to-revoke-live`) → **Revoke** → select **Safety breach** (code 1) → confirm → sign.
2. On Basescan: event `CredentialRevoked(id, issuer, holder, reason=1, revokedAt)`.
3. *Window 1*: verify the `to-revoke-live` ID (or click **Refresh** if it is already displayed) → **Revoked** ·
   reason "Safety breach" · date and time. The record still exists: revocation **never deletes** anything.

---

## 6. Failure cases with readable reasons (2 min)

Each one is shown in the UI (the call is simulated before signing, exactly like a wallet does) and in the
terminal.

| # | Scenario | How | Expected |
| --- | --- | --- | --- |
| 1 | A non-issuer tries to issue | MetaMask on **Holder**, page Issuer: orange banner "not an accredited issuer", submit the form | `Reverted: NotAuthorizedIssuer(0x…)`: "This wallet is not an accredited issuer…" |
| 2 | Another issuer tries to revoke | MetaMask on **Issuer B**, Overview → *Revoke a credential by ID* (demo mode), paste the `valid-nuclear` ID → Revoke | `Reverted: NotCredentialIssuer(id, 0x…)`: "Only the organization that issued this credential can revoke it." |
| 3 | The holder tries to transfer | MetaMask on **Holder**, page My credentials → **Try to transfer** (demo mode) | `Reverted: CredentialNonTransferable(id)`: "…can never be transferred." |

Same thing from the terminal, in one command:

```bash
pnpm demo:failures:base-sepolia
```

```
  ✔ 1. Non-issuer 0x… tries to issue a credential
      reverted with NotAuthorizedIssuer(0x…)
  ✔ 2. Other issuer 0x… tries to revoke issuer A's credential
      reverted with NotCredentialIssuer(0x…, 0x…)
  ✔ 3. Holder 0x… tries to transfer the credential
      reverted with CredentialNonTransferable(0x…)
  ✔ 4. Issuer A revokes with an invalid reason code (0)
      reverted with InvalidRevocationReason(0)
```

Finish with `pnpm test` (54 passing) and `pnpm coverage` (100 % lines / statements).

---

## 7. Expected questions

- **Why not a soulbound ERC-721?** No transfer surface at all instead of disabling one; ERC-721 selectors do not
  exist (tested); `transferCredential` exists only to fail with a clear error.
- **Who controls the registry?** A Safe multisig; two-step ownership; `renounceOwnership` disabled; the deployer
  keeps no power (`SiteCredentialManager` has no owner).
- **What if an issuer is compromised?** The admin suspends it: its credentials show *Issuer suspended*
  (fail-closed); it can still revoke; it can be reinstated.
- **How do you know `0x7099…` is really Apave?** Registry metadata plus the DNS TXT record `_sitepass.apave.com`
  over DoH. Compromising one channel is not enough.
- **GDPR?** Only a salted SHA-256 is on-chain; the certificate is the only copy of the personal data; deleting it
  makes the hash meaningless.
- **Difference with EAS?** See the README table: closed issuer set, mandatory revocation reasons, computed status,
  issuer identity cross-check.

---

## Fallback: local chain

```bash
pnpm dev                       # chain + deploy + seed + web on http://localhost:5173
pnpm demo:failures:local
```

Accounts: see the table in the README (Hardhat test keys #0-#4). The demo documents are in `demo/localhost/`.
Expiry works the same (a block is mined every 2 s).
