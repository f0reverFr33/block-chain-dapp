import assert from "node:assert/strict";
import hre from "hardhat";

async function main() {
  const { ethers } = await hre.network.connect();
  const [provider, trader] = await ethers.getSigners();
  const providerAddress = await provider.getAddress();
  const traderAddress = await trader.getAddress();

  const tokenA = await ethers.deployContract("TestToken", ["Test Token A", "TKA"]);
  const tokenB = await ethers.deployContract("TestToken", ["Test Token B", "TKB"]);
  const miniDEX = await ethers.deployContract("MiniDEX");
  await Promise.all([
    tokenA.waitForDeployment(),
    tokenB.waitForDeployment(),
    miniDEX.waitForDeployment(),
  ]);
  const tokenAAddress = await tokenA.getAddress();
  const tokenBAddress = await tokenB.getAddress();
  const dexAddress = await miniDEX.getAddress();
  console.log("✓ 部署 TKA、TKB 和 MiniDEX");

  await (await miniDEX.createPool(tokenAAddress, tokenBAddress)).wait();
  assert.equal(await miniDEX.poolCount(), 1n);
  console.log("✓ 创建 TKA/TKB 池子");

  const initialA = ethers.parseEther("10000");
  const initialB = ethers.parseEther("20000");
  await (await tokenA.approve(dexAddress, initialA)).wait();
  await (await tokenB.approve(dexAddress, initialB)).wait();
  await (await miniDEX.addLiquidity(0, initialA, initialB, initialA, initialB)).wait();
  assert.equal(await miniDEX.ownerOf(1), providerAddress);
  console.log("✓ 注入 10000 TKA + 20000 TKB，获得 LP NFT #1");

  const amountIn = ethers.parseEther("100");
  const effectiveInput = amountIn * 997n / 1000n;
  const expectedOutput = effectiveInput * initialB / (initialA + effectiveInput);
  await (await tokenA.connect(trader).faucet()).wait();
  await (await tokenA.connect(trader).approve(dexAddress, amountIn)).wait();
  await (
    await miniDEX.connect(trader).swapExactInput(
      0,
      tokenAAddress,
      amountIn,
      expectedOutput,
    )
  ).wait();
  assert.equal(await tokenB.balanceOf(traderAddress), expectedOutput);
  console.log(`✓ 交易者用 100 TKA 换得 ${ethers.formatEther(expectedOutput)} TKB`);

  const poolBeforeExit = await miniDEX.getPool(0);
  await (
    await miniDEX.removeLiquidity(1, poolBeforeExit.reserveA, poolBeforeExit.reserveB)
  ).wait();
  const poolAfterExit = await miniDEX.getPool(0);
  assert.equal(poolAfterExit.reserveA, 0n);
  assert.equal(poolAfterExit.reserveB, 0n);
  assert.equal(poolAfterExit.totalShares, 0n);
  assert.equal(await miniDEX.balanceOf(providerAddress), 0n);
  console.log("✓ 销毁 LP NFT #1，赎回全部两种代币");

  console.log("\n完整冒烟测试通过：部署 → 建池 → 注资 → 交换 → 赎回");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
