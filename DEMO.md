# SitePass - Defense demo script

Duration: about 15 minutes. Profiles on **Base Sepolia**: **people of two training organizations** (admins and
trainers), a **holder**, a **verifier without a wallet**, and a **candidate organization**. The same script works on
the local chain (`pnpm dev`) as a fallback if the testnet or the Wi-Fi fails.

There is **no registry admin** anywhere in this script: the organizations govern the registry themselves.

---

## 0. Preparation (the day before)

### 0.1 Wallets and deployment

```bash
pnpm install
pnpm env:init
pnpm env:keys                 # generates DEPLOYER / ADMIN_A1 / ADMIN_A2 / ISSUER_A / ISSUER_A2 /
                              # ADMIN_B / ISSUER_B / ADMIN_C / HOLDER wallets in .env
```

1. Fund the **deployer** address printed by `pnpm env:keys` with ~0.03 Base Sepolia ETH (faucet). The deploy script
   tops up every demo person with a little gas.
2. Set a short timelock so that an admission can be executed during the talk: `GOVERNANCE_TIMELOCK_DELAY=120`
   (seconds). Leave it empty for the production default (2 days).
3. *(Optional, for a green DNS check)* Set `ISSUER_A_DOMAIN` to a domain you control. After deploying, publish
   `_sitepass.<domain> TXT "sitepass-issuer=<Organization A contract>"` (the deploy script prints the exact record).
   Leave `ISSUER_B_DOMAIN=issuer-b.example` to show the "No DNS proof" case.
4. Set `SEED_SHORT_EXPIRY_MINUTES=5` (the expired demo badge) and `VITE_NETWORK=baseSepolia`.

```bash
pnpm deploy:base-sepolia      # registry (creates + admits orgs A and B) + manager + 4 demo credentials
pnpm verify:base-sepolia      # publish sources on the explorer (registry, both organizations, manager)
pnpm test                     # keep the green output in a terminal tab
```

Nothing to hand over afterwards: the deployer never had any role.

### 0.2 Fill in the addresses

Copy them from `packages/contracts/deployments/baseSepolia.json` and `demo/baseSepolia/seed-summary.json`:

| Item | Value |
| --- | --- |
| `IssuerRegistry` | `0x…` |
| `SiteCredentialManager` | `0x…` |
| Organization A (contract) | `0x…` |
| Organization B (contract) | `0x…` |
| Admin A1 / Admin A2 (A is 2-of-2) | `0x…` / `0x…` |
| Trainer A / Trainer A2 (members of A) | `0x…` / `0x…` |
| Admin B / Trainer B | `0x…` / `0x…` |
| Admin C (candidate) | `0x…` |
| Holder (worker) | `0x…` |
| Credential `valid-nuclear` (NUC-PR1-CC) | `0x…` |
| Credential `to-revoke-live` (ELEC-B2V) | `0x…` |
| Credential `short-expiry` (BTP-WORK-AT-HEIGHT) | `0x…` |
| Credential `already-revoked` (HAZ-ATEX-1) | `0x…` |

The matching certificates are in `demo/baseSepolia/*.json`.

### 0.3 Browser setup

- **Window 1 (verifier)**: a **private window with no wallet extension**. This proves the "no wallet" constraint.
- **Window 2 (people)**: normal window with MetaMask, holding the imported accounts: Admin A1, Admin A2, Trainer A,
  Trainer A2, Trainer B, Admin C, Holder (keys from `.env`).
- Tabs: Basescan on the `SiteCredentialManager` and `IssuerRegistry` addresses (*Events* tab).
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
- Three contracts: `IssuerRegistry` (federation of organizations, **no owner**), one `Organization` per training
  organization (a multisig of its people), `SiteCredentialManager` (attestations mapping, no token).
- Show the **Accredited organizations** page (public): each organization is a contract address (its identity),
  with its domain, DNS badge and its people (2-of-2 admins, 2 trainers for A).

---

## 2. An organization is a multisig of people (1 min)

*Window 2, MetaMask on **Admin A1**, page **My organization** (`/organization`).*

1. Show the admins and issuing members of Issuer A, and the **2-of-2** threshold.
2. Propose **Add issuing member** with any fresh address → the proposal shows **1 / 2**: nothing happens.
3. Switch to **Admin A2** → **Approve** → **2 / 2**, then **Timelock**: granting power waits for the delay.
4. Point out: removing a person (lost or stolen key) runs as soon as the threshold is reached, without timelock.

---

## 3. Issuance; the event on the explorer (2 min)

*Window 2, MetaMask on **Trainer A**, page **Issue a credential** (`/issuer/new`).*

1. The header card shows "Issuer A · Accredited" and its DNS status.
2. Fill in the form: holder = Holder address, name `Jean Dupont`, birth date, clearance
   **Radiation Protection - Level 1 (PR1-CC)**, expiry in 3 years.
3. Point out the right panel: the JSON certificate (with its random **salt**, the organization contract as issuer and
   the trainer as `signer`) and its **SHA-256**, both computed locally. Only the hash goes on-chain.
4. **Issue credential** → sign → toast "Credential issued". The certificate file downloads automatically.
5. Click **View event on explorer** → Basescan shows `CredentialIssued(id, issuer = organization, holder, signer =
   trainer, credentialType, documentHash, issuedAt, expiresAt)`. Point out that **no name or birth date** appears
   anywhere in the transaction (input data / logs).
6. Copy the credential ID.

---

## 4. Verification without a wallet (2 min)

*Window 1, private window, no extension.*

1. Open the app. The **Verify a credential** page is marked "No wallet needed"; all reads go
   through the public Base Sepolia RPC with free `eth_call`.
2. Paste the credential ID → **Valid** (green check icon): clearance, issuing organization + domain + DNS badge,
   signing trainer, holder, issue date, validity window, on-chain SHA-256.
3. **Drag and drop** the downloaded JSON → "Document authentic - SHA-256 matches", with identity from the document
   (to compare with the worker's ID card) and consistency checks (holder, issuer, type, expiry, contract).
4. Open the JSON in an editor, change one letter of the name, save, drop it again → **Document does NOT match**.
5. Search by **holder address** → the list of all the worker's credentials: valid, already revoked
   (MEDICAL_UNFIT), expired (`short-expiry`, expired a few minutes after seeding).
6. Drop `demo/baseSepolia/4-already-revoked-*.json` without typing anything: the credential is found from the
   document alone (`getCredentialsByDocumentHash`).

---

## 5. Proof of control by the holder (2 min)

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
5. **Counter-example**: generate a new challenge, sign it with **Trainer B's** account → "Proof rejected (wrong
   signer)".
6. Show the holder's credentials (`/wallet`, or the shareable public page `/holder/<address>`) and a "Show to
   verifier" QR code per badge.

---

## 6. Live revocation by a colleague (1 min)

*Window 2, MetaMask on **Trainer A2**, page **Overview** (`/issuer`).*

1. The list shows every credential of Issuer A, with the trainer who signed each one.
2. Find `ELEC-B2V` (`to-revoke-live`, signed by **Trainer A**) → **Revoke** → **Safety breach** (code 1) → sign.
   A colleague can revoke: the credential belongs to the organization, not to the person who signed it.
3. On Basescan: event `CredentialRevoked(id, issuer, holder, revokedBy = Trainer A2, reason = 1, revokedAt)`.
4. *Window 1*: verify the `to-revoke-live` ID → **Revoked** · reason "Safety breach" · date · revoked by. The record
   still exists: revocation **never deletes** anything.

---

## 7. Governance: suspension and admission by vote (3 min)

*Window 2, page **Federation governance** (`/governance`).*

1. Stats: 2 voting organizations, quorum **> 50%**, timelock, proposal lifetime. The registry contract has no owner.
2. **Suspension (emergency)**. As **Admin A1**: *Open a federation proposal* → **Suspend organization** → Issuer B.
   Issuer B cannot vote on its own suspension, so Issuer A is the only eligible voter. **Vote as Issuer A** →
   "Issuer A: 1/2 admins". Switch to **Admin A2** → **Co-sign Issuer A vote** → the suspension runs at once.
3. *Window 1*: verify a valid credential of Issuer B (have **Trainer B** issue one before step 2; the seeded
   `already-revoked` stays *Revoked*, which takes precedence) → **Issuer suspended** (fail-closed). Trainer B can no
   longer issue (`NotAuthorizedIssuer`), but can still revoke.
4. **Admission (timelocked)**. As **Admin C**: *Create an organization* ("Issuer C", `issuer-c.example`, Admin C as
   admin and member) → the organization is **pending**. Then *Open a federation proposal* → **Admit organization**
   → Issuer C.
5. As **Admin A1** then **Admin A2**: vote for Issuer A → quorum reached → **Timelock** countdown.
6. After the delay, anyone clicks **Execute** → Issuer C is accredited, Admin C can issue.
7. *(Optional)* Reinstate Issuer B the same way (timelocked).

---

## 8. Failure cases with readable reasons (2 min)

Each one is shown in the UI (the call is simulated before signing, exactly like a wallet does) and in the
terminal.

| # | Scenario | How | Expected |
| --- | --- | --- | --- |
| 1 | A wallet with no role tries to issue | MetaMask on **Holder**, page Issuer: orange banner, submit the form | `Reverted: NotAuthorizedIssuer(0x…)` |
| 2 | Another organization tries to revoke | MetaMask on **Trainer B**, Overview → *Revoke a credential by ID* (demo mode), paste the `valid-nuclear` ID → Revoke | `Reverted: NotCredentialIssuer(id, 0x…)` |
| 3 | The holder tries to transfer | MetaMask on **Holder**, page My credentials → **Try to transfer** (demo mode) | `Reverted: CredentialNonTransferable(id)` |
| 4 | An admin who is not a member issues | MetaMask on **Admin A1**, page Issue a credential | `Reverted: NotAuthorizedIssuer(0x…)`: governing is not issuing |
| 5 | Someone outside the organizations proposes | MetaMask on **Holder**, governance → open a suspension | `Reverted: NotAuthorizedProposer(0x…)` |

Same thing from the terminal, in one command:

```bash
pnpm demo:failures:base-sepolia
```

```
  ✔ 1. Wallet with no role 0x… tries to issue a credential
      reverted with NotAuthorizedIssuer(0x…)
  ✔ 2. Member of organization B 0x… tries to revoke organization A's credential
      reverted with NotCredentialIssuer(0x…, 0x…)
  ✔ 3. Holder 0x… tries to transfer the credential
      reverted with CredentialNonTransferable(0x…)
  ✔ 4. Member of organization A 0x… revokes with an invalid reason code (0)
      reverted with InvalidRevocationReason(0)
  ✔ 5. Admin of organization A 0x… (not a member) tries to issue
      reverted with NotAuthorizedIssuer(0x…)
  ✔ 6. The deployer 0x… tries to suspend organization A (no admin exists)
      reverted with NotAuthorizedProposer(0x…)
  ✔ 7. Admin 0x… votes alone, with their own wallet, instead of through the org multisig
      reverted with OrganizationNotActive(0x…)
```

Finish with `pnpm test` (93 Solidity + 7 integration tests passing) and `pnpm coverage` (100 % lines / statements).

---

## 9. Expected questions

- **Who controls the registry?** Nobody alone. The accredited organizations vote (strictly more than the quorum,
  a strict majority by default, changeable by vote between 50 % and 100 %). Each organization votes through its own
  M-of-N multisig of people, so one stolen key is never a vote. The deployer never held any role.
- **What if an organization is compromised?** The others suspend it by vote, immediately (no timelock): its
  credentials show *Issuer suspended* (fail-closed); its members can still revoke; it can be reinstated by vote.
- **What if a trainer's key is stolen or the trainer leaves?** The organization's admins remove them (immediate, no
  timelock). Their past credentials remain valid (they belong to the organization) and any other member can revoke
  them.
- **Why a timelock?** Everything that grants power (admission, reinstatement, new member/admin, threshold or quorum
  change) waits, so that a captured majority cannot act silently. Proposals also expire.
- **Can the federation brick itself?** The last active organization cannot be suspended, and an organization never
  votes on its own suspension. An admin cannot leave if the threshold would become unreachable.
- **Why not a soulbound ERC-721?** No transfer surface at all instead of disabling one; ERC-721 selectors do not
  exist (tested); `transferCredential` exists only to fail with a clear error.
- **How do you know `0xa16E…` is really Issuer A?** Registry metadata (voted) plus the DNS TXT record
  `_sitepass.<ISSUER_A_DOMAIN>` pointing to the organization contract, checked over DoH. The contract address never
  changes when people change, so the record is published once.
- **GDPR?** Only a salted SHA-256 is on-chain; the certificate is the only copy of the personal data; deleting it
  makes the hash meaningless.
- **Difference with EAS?** See the README table: closed, self-governed issuer set, mandatory revocation reasons,
  computed status, issuer identity cross-check.

---

## Fallback: local chain

```bash
pnpm dev                       # chain + deploy + seed + web on http://localhost:5173
pnpm demo:failures:local
```

Accounts: see the table in the README (Hardhat test keys #0-#9). The timelock is 60 s on the local chain. The demo
documents are in `demo/localhost/`. Expiry works the same (a block is mined every 2 s).
