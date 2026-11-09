import {
  type Address,
  type EIP1193Provider,
  type Hex,
  type LocalAccount,
  ProviderRpcError,
  SwitchChainError,
  type TypedDataDefinition,
  createWalletClient,
  getAddress,
  http,
  isAddressEqual,
  numberToHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createConnector } from "wagmi";

/**
 * Built-in wallet for demos on the local chain.
 *
 * It signs locally with Hardhat's public test keys, so a presenter can switch
 * between the registry admin, the issuers and the worker in one click instead
 * of juggling MetaMask accounts. Every transaction still goes through the
 * real contracts (simulate → sign → send), only the key management differs.
 */
export const DEMO_CONNECTOR_ID = "sitepassDemo";

const ACCOUNT_KEY = "sitepass.demo-wallet.account";
const CONNECTED_KEY = "sitepass.demo-wallet.connected";

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

type Emit = (accounts: Address[]) => void;
let emitAccounts: Emit | undefined;
let selectAccount: ((address: Address) => boolean) | undefined;

/**
 * Makes `address` the active demo account. Returns false when the demo wallet
 * has no key for it. Connected dApps receive an `accountsChanged` event.
 */
export function switchDemoAccount(address: Address): boolean {
  return selectAccount?.(address) ?? false;
}

class UnsupportedMethodError extends ProviderRpcError {
  constructor(method: string) {
    super(new Error(`The demo wallet does not support ${method}.`), {
      code: 4200,
      shortMessage: `The demo wallet does not support ${method}.`,
    });
  }
}

/** JSON typed data carries integers as strings: restore bigints per the schema. */
function reviveTypedData(json: string | Record<string, unknown>): TypedDataDefinition {
  const data = (typeof json === "string" ? JSON.parse(json) : json) as {
    domain: Record<string, unknown>;
    types: Record<string, { name: string; type: string }[]>;
    primaryType: string;
    message: Record<string, unknown>;
  };
  const { EIP712Domain: _domain, ...types } = data.types;

  function revive(type: string, value: unknown): unknown {
    if (type.endsWith("]") && Array.isArray(value)) {
      const inner = type.slice(0, type.lastIndexOf("["));
      return value.map((item) => revive(inner, item));
    }
    if (/^u?int\d*$/.test(type) && (typeof value === "string" || typeof value === "number")) return BigInt(value);
    const fields = types[type];
    if (fields && value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      return Object.fromEntries(fields.map((field) => [field.name, revive(field.type, record[field.name])]));
    }
    return value;
  }

  return {
    domain: data.domain,
    types,
    primaryType: data.primaryType,
    message: revive(data.primaryType, data.message) as Record<string, unknown>,
  } as unknown as TypedDataDefinition;
}

export function demoWallet({ keys, rpcUrl }: { keys: Hex[]; rpcUrl: string }) {
  const accounts: LocalAccount[] = keys.map((key) => privateKeyToAccount(key));

  return createConnector((config) => {
    const chain = config.chains[0];
    const rpc = http(rpcUrl)({ chain, retryCount: 0 });

    const stored = storage()?.getItem(ACCOUNT_KEY);
    let current: LocalAccount =
      accounts.find((account) => stored && isAddressEqual(account.address, stored as Address)) ?? accounts[0];
    let connected = false;

    emitAccounts = (next) => config.emitter.emit("change", { accounts: next });
    selectAccount = (address) => {
      const next = accounts.find((account) => isAddressEqual(account.address, address));
      if (!next) return false;
      current = next;
      storage()?.setItem(ACCOUNT_KEY, next.address);
      if (connected) emitAccounts?.([next.address]);
      return true;
    };

    const request = async ({ method, params }: { method: string; params?: unknown }): Promise<unknown> => {
      const args = (params ?? []) as unknown[];
      switch (method) {
        case "eth_chainId":
          return numberToHex(chain.id);
        case "eth_accounts":
          return connected ? [current.address] : [];
        case "eth_requestAccounts":
          return [current.address];
        case "eth_sendTransaction": {
          const tx = args[0] as { from?: Address; to?: Address; data?: Hex; value?: Hex; gas?: Hex };
          if (tx.from && !isAddressEqual(tx.from, current.address)) {
            throw new Error(`The demo wallet is on ${current.address}, not ${tx.from}.`);
          }
          const wallet = createWalletClient({ account: current, chain, transport: http(rpcUrl) });
          return wallet.sendTransaction({
            to: tx.to,
            data: tx.data,
            value: tx.value ? BigInt(tx.value) : undefined,
            gas: tx.gas ? BigInt(tx.gas) : undefined,
          });
        }
        case "eth_signTypedData_v4":
          return current.signTypedData(reviveTypedData(args[1] as string));
        case "personal_sign":
          return current.signMessage({ message: { raw: args[0] as Hex } });
        case "wallet_switchEthereumChain": {
          const target = Number((args[0] as { chainId: Hex }).chainId);
          if (target !== chain.id) throw new SwitchChainError(new Error(`Chain ${target} is not available in the demo.`));
          return null;
        }
        default:
          if (method.startsWith("wallet_") || method === "eth_sign" || method === "eth_signTransaction") {
            throw new UnsupportedMethodError(method);
          }
          return rpc.request({ method, params } as never);
      }
    };
    const provider = { request, on: () => {}, removeListener: () => {} } as unknown as EIP1193Provider;

    return {
      id: DEMO_CONNECTOR_ID,
      name: "Demo wallet",
      icon: undefined as string | undefined,
      type: DEMO_CONNECTOR_ID,
      async connect(parameters?: { chainId?: number; isReconnecting?: boolean }) {
        if (parameters?.chainId && parameters.chainId !== chain.id) {
          throw new SwitchChainError(new Error(`Chain ${parameters.chainId} is not available in the demo.`));
        }
        connected = true;
        storage()?.setItem(CONNECTED_KEY, "1");
        return { accounts: [current.address], chainId: chain.id } as never;
      },
      async disconnect() {
        connected = false;
        storage()?.removeItem(CONNECTED_KEY);
      },
      async getAccounts() {
        return connected ? [current.address] : [];
      },
      async getChainId() {
        return chain.id;
      },
      async getProvider() {
        return provider;
      },
      async isAuthorized() {
        return storage()?.getItem(CONNECTED_KEY) === "1";
      },
      async switchChain({ chainId }: { chainId: number }) {
        if (chainId !== chain.id) throw new SwitchChainError(new Error(`Chain ${chainId} is not available in the demo.`));
        return chain;
      },
      onAccountsChanged(next: string[]) {
        if (next.length === 0) this.onDisconnect();
        else config.emitter.emit("change", { accounts: next.map((account) => getAddress(account)) });
      },
      onChainChanged(next: string) {
        config.emitter.emit("change", { chainId: Number(next) });
      },
      onDisconnect() {
        connected = false;
        config.emitter.emit("disconnect");
      },
    };
  });
}
