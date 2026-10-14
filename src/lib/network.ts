// Which chain Kesuni's money runs on. Switching from Arc Testnet to Arc mainnet is configuration
// (env), not code: CIRCLE_BLOCKCHAIN, plus the checks in docs/PILOT.md "Switching to mainnet".
// Pure env reads, no Circle SDK here, so any server module can import it.
//
// Safety switch: a mainnet chain moves real money, so it also needs KESUNI_ALLOW_MAINNET=1.
// Without it the Circle gateway refuses to create wallets or send USDC (see circle.ts).

/** USDC on Arc Testnet: ERC-20 interface at this address, 6 decimals (native gas view uses 18; never mix). */
export const ARC_USDC = "0x3600000000000000000000000000000000000000";

const TESTNET_EXPLORER = "https://explorer.testnet.arc.io/tx/";
// Not verified: Arc mainnet's explorer. Set KESUNI_EXPLORER_TX_URL to be sure.
const MAINNET_EXPLORER = "https://explorer.arc.io/tx/";

export interface Network {
  blockchain: string;          // Circle enum: "ARC-TESTNET" (default) or "ARC" (mainnet)
  isTestnet: boolean;
  label: "testnet" | "mainnet";
  name: string;                // "Arc Testnet" | "Arc"
  explorerTxBase: string;      // tx hash is appended
  usdcAddress: string;
  explorerTxUrl: (hash: string) => string;
}

/** Circle names testnets "<CHAIN>-TESTNET" (or Sepolia/Amoy/Fuji/Devnet for other chains). */
export const isTestnetChain = (blockchain: string): boolean => /TESTNET|SEPOLIA|AMOY|FUJI|DEVNET/i.test(blockchain);

const nameOf = (chain: string) => (chain === "ARC-TESTNET" ? "Arc Testnet" : chain === "ARC" ? "Arc" : chain);
const currentChain = () => (process.env.CIRCLE_BLOCKCHAIN || "ARC-TESTNET").trim().toUpperCase();

/** Explorer link base for a chain. KESUNI_EXPLORER_TX_URL applies to the configured chain only. */
export function explorerTxBase(blockchain = currentChain()): string {
  const custom = process.env.KESUNI_EXPLORER_TX_URL;
  if (custom && blockchain === currentChain()) return custom.endsWith("/") ? custom : `${custom}/`;
  return isTestnetChain(blockchain) ? TESTNET_EXPLORER : MAINNET_EXPLORER;
}

export function network(): Network {
  const blockchain = currentChain();
  const isTestnet = isTestnetChain(blockchain);
  const base = explorerTxBase(blockchain);
  return {
    blockchain,
    isTestnet,
    label: isTestnet ? "testnet" : "mainnet",
    name: nameOf(blockchain),
    explorerTxBase: base,
    // Verify on mainnet: the USDC address is taken from Arc's docs before switching.
    usdcAddress: process.env.KESUNI_USDC_ADDRESS || ARC_USDC,
    explorerTxUrl: (hash) => `${base}${hash}`,
  };
}

/** What a client component needs (no functions, no secrets). */
export type PublicNetwork = Pick<Network, "blockchain" | "isTestnet" | "label" | "name" | "explorerTxBase">;
export function publicNetwork(blockchain?: string): PublicNetwork {
  const chain = blockchain ?? currentChain();
  const isTestnet = isTestnetChain(chain);
  return { blockchain: chain, isTestnet, label: isTestnet ? "testnet" : "mainnet", name: nameOf(chain), explorerTxBase: explorerTxBase(chain) };
}

/** Throws unless money may move on this chain: testnets always; mainnet only with KESUNI_ALLOW_MAINNET=1. */
export function assertMoneyAllowed(blockchain: string): void {
  if (isTestnetChain(blockchain)) return;
  if (process.env.KESUNI_ALLOW_MAINNET === "1") return;
  throw new Error(
    `Mainnet is locked: ${blockchain} moves real USDC. Set KESUNI_ALLOW_MAINNET=1 only after the owner and Sabina ` +
    "approve and the checks in docs/PILOT.md are done.",
  );
}
