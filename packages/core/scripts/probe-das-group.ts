// Probe: does a DAS RPC enumerate Token-2022 TokenGroup members via
// getAssetsByGroup(groupKey:"collection")? This is the single unverified fact
// the umbrella/§4 design rests on (see src/core/skillSource.ts dasSource).
//
// Read-only — no SOL spent, runs against mainnet (or any DAS RPC). It does NOT
// assert anything; it reports exactly what the RPC returns and prints a verdict.
//
// Usage:
//   export DAS_RPC_URL="https://mainnet.helius-rpc.com/?api-key=..."   # must support DAS
//   export PROBE_COLLECTION="<token-2022 TokenGroup mint>"            # or AGENTNET_SKILLS_COLLECTION_PUBKEY
//   export PROBE_MEMBER="<a known member mint>"                       # optional but recommended
//   npx tsx scripts/probe-das-group.ts
//
// Interpreting the result:
//   A. getAssetsByGroup returns the member  -> §4 works as designed. Ship dasSource.
//   B. it returns nothing, BUT getAsset(member).mint_extensions shows
//      token_group_member -> DAS indexes the 2022 group extension but NOT under
//      the "collection" group key. getAssetsByGroup("collection") is the wrong
//      call; need searchAssets / a different grouping. dasSource needs a rewrite.
//   C. neither -> this DAS provider doesn't index Token-2022 groups at all.
//      Keep the index-table CacheLayer; revisit with a different provider.

const rpcUrl = process.env.DAS_RPC_URL;
const collection = process.env.PROBE_COLLECTION || process.env.AGENTNET_SKILLS_COLLECTION_PUBKEY;
const member = process.env.PROBE_MEMBER;

async function rpc(method: string, params: unknown): Promise<any> {
  const res = await fetch(rpcUrl!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "probe", method, params }),
  });
  return res.json();
}

async function main() {
  if (!rpcUrl) throw new Error("set DAS_RPC_URL (a DAS-capable RPC, e.g. Helius mainnet)");
  if (!collection) throw new Error("set PROBE_COLLECTION (the Token-2022 TokenGroup mint)");

  console.log("DAS RPC:", rpcUrl.replace(/api-key=[^&]+/, "api-key=***"));
  console.log("Collection:", collection);
  console.log("Member:", member ?? "(none provided)");
  console.log("");

  // 1. The actual call dasSource makes.
  console.log("── getAssetsByGroup(groupKey: collection) ──");
  const byGroup = await rpc("getAssetsByGroup", {
    groupKey: "collection",
    groupValue: collection,
    page: 1,
    limit: 100,
  });
  if (byGroup.error) {
    console.log("  RPC error:", JSON.stringify(byGroup.error));
  } else {
    const items = byGroup.result?.items ?? [];
    console.log(`  total returned: ${items.length}`);
    for (const it of items.slice(0, 10)) console.log("   -", it.id);
  }

  // 2. Inspect one member directly — does DAS even index its group membership?
  let memberShowsGroup = false;
  let memberInByGroup = false;
  if (member) {
    console.log("\n── getAsset(member) ──");
    const asset = await rpc("getAsset", { id: member });
    if (asset.error) {
      console.log("  RPC error:", JSON.stringify(asset.error));
    } else {
      const grouping = asset.result?.grouping ?? [];
      const ext = asset.result?.mint_extensions ?? asset.result?.token_info?.mint_extensions;
      console.log("  grouping:", JSON.stringify(grouping));
      console.log("  mint_extensions:", JSON.stringify(ext)?.slice(0, 400));
      memberShowsGroup = JSON.stringify(ext ?? {}).includes("group_member")
        || grouping.some((g: any) => g.group_value === collection);
      const ids = (byGroup.result?.items ?? []).map((i: any) => i.id);
      memberInByGroup = ids.includes(member);
    }
  }

  // 3. Verdict.
  console.log("\n══ VERDICT ══");
  if (memberInByGroup) {
    console.log("A. getAssetsByGroup returns the member → §4 works. dasSource is correct.");
  } else if (memberShowsGroup) {
    console.log(
      "B. DAS indexes the Token-2022 group on the asset, but getAssetsByGroup(collection)\n" +
        "   does NOT return it. dasSource's query is wrong — needs searchAssets / different key.",
    );
  } else if (member) {
    console.log(
      "C. DAS does not surface this Token-2022 group at all. Keep the index-table\n" +
        "   CacheLayer; this provider can't back dasSource.",
    );
  } else {
    console.log(
      "Inconclusive — provide PROBE_MEMBER (a known member mint) to distinguish B vs C.",
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
