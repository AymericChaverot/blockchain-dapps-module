import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import type { Abi, ContractFunctionArgs, ContractFunctionName, Hex, TransactionReceipt } from "viem";
import { useAccount, useConfig } from "wagmi";
import { simulateContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";

import { explorerTxUrl } from "@/config/network";
import { type DecodedError, decodeError } from "@/lib/errors";

type WriteName<TAbi extends Abi> = ContractFunctionName<TAbi, "nonpayable" | "payable">;

export interface ActionRequest<TAbi extends Abi, TName extends WriteName<TAbi>> {
  address: `0x${string}`;
  abi: TAbi;
  functionName: TName;
  args: ContractFunctionArgs<TAbi, "nonpayable" | "payable", TName>;
}

/**
 * simulate → sign → wait, with readable revert reasons.
 *
 * The simulation runs first (as a wallet would), so an unauthorized call fails
 * instantly with the decoded custom error (e.g. `NotAuthorizedIssuer`) instead
 * of an opaque wallet message.
 */
export function useContractAction() {
  const config = useConfig();
  const queryClient = useQueryClient();
  const { address } = useAccount();
  const [pending, setPending] = useState(false);
  const [lastError, setLastError] = useState<DecodedError>();

  async function run<TAbi extends Abi, TName extends WriteName<TAbi>>(
    request: ActionRequest<TAbi, TName>,
    labels: { pending: string; success: string },
  ): Promise<{ hash: Hex; receipt: TransactionReceipt } | undefined> {
    setPending(true);
    setLastError(undefined);
    const toastId = toast.loading(labels.pending);
    try {
      // The generic request is forwarded as-is; viem validates it at runtime.
      const { request: prepared } = await simulateContract(config, { ...request, account: address } as never);
      toast.loading("Confirm in your wallet…", { id: toastId });
      const hash = await writeContract(config, prepared);
      toast.loading("Waiting for confirmation…", { id: toastId });
      const receipt = await waitForTransactionReceipt(config, { hash });
      if (receipt.status !== "success") throw new Error(`Transaction reverted (${hash})`);
      const url = explorerTxUrl(hash);
      toast.success(labels.success, {
        id: toastId,
        description: url ? "View the transaction on the block explorer." : hash,
        action: url ? { label: "Explorer", onClick: () => window.open(url, "_blank") } : undefined,
      });
      await queryClient.invalidateQueries();
      return { hash, receipt };
    } catch (error) {
      const decoded = decodeError(error);
      setLastError(decoded);
      toast.error(decoded.title, { id: toastId, description: decoded.description });
      return undefined;
    } finally {
      setPending(false);
    }
  }

  return { run, pending, lastError, clearError: () => setLastError(undefined) };
}
