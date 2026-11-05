import assert from "node:assert/strict";
import hre from "hardhat";

function quote(amountIn: bigint, reserveIn: bigint, reserveOut: bigint) {
  const effectiveInput = amountIn * 997n / 1000n;
  return effectiveInput * reserveOut / (reserveIn + effectiveInput);
}

async function main() {
  const { ethers } = await hre.network.connect();
  const [owner, trader] = await ethers.getSigners();
  const tokenA = await ethers.deployContract("TestToken", ["Test Token A", "TKA"]);
  const tokenB = await ethers.deployContract("TestToken", ["Test Token B", "TKB"]);
  const cheapDex = await ethers.deployContract("MiniDEX");
  const expensiveDex = await ethers.deployContract("MiniDEX");
  const arbitrage = await ethers.deployContract("AtomicArbitrage");
  await Promise.all([
    tokenA.waitForDeployment(),
    tokenB.waitForDeployment(),
    cheapDex.waitForDeployment(),
    expensiveDex.waitForDeployment(),
    arbitrage.waitForDeployment(),
  ]);

  const tokenAAddress = await tokenA.getAddress();
  const tokenBAddress = await tokenB.getAddress();
  const cheapDexAddress = await cheapDex.getAddress();
  const expensiveDexAddress = await expensiveDex.getAddress();
  await (await cheapDex.createPool(tokenAAddress, tokenBAddress)).wait();
  await (await expensiveDex.createPool(tokenAAddress, tokenBAddress)).wait();
  for (const dexAddress of [cheapDexAddress, expensiveDexAddress]) {
    await (await tokenA.approve(dexAddress, ethers.MaxUint256)).wait();
    await (await tokenB.approve(dexAddress, ethers.MaxUint256)).wait();
  }
  await (
    await cheapDex.addLiquidity(
      0,
      ethers.parseEther("1000"),
      ethers.parseEther("3000"),
      0,
      0,
    )
  ).wait();
  await (
    await expensiveDex.addLiquidity(
      0,
      ethers.parseEther("3000"),
      ethers.parseEther("1000"),
      0,
      0,
    )
  ).wait();
  console.log("✓ 两个交易所出现价差：1 TKA 分别约值 3 TKB 和 0.333 TKB");

  const amountIn = ethers.parseEther("100");
  const amountB = quote(
    amountIn,
    ethers.parseEther("1000"),
    ethers.parseEther("3000"),
  );
  const expectedOutput = quote(
    amountB,
    ethers.parseEther("1000"),
    ethers.parseEther("3000"),
  );
  await (await tokenA.connect(trader).faucet()).wait();
  await (await tokenA.connect(trader).approve(await arbitrage.getAddress(), amountIn)).wait();
  const balanceBefore = await tokenA.balanceOf(await trader.getAddress());
  await (
    await arbitrage.connect(trader).arbitrage({
      buyDex: cheapDexAddress,
      sellDex: expensiveDexAddress,
      buyPoolId: 0,
      sellPoolId: 0,
      tokenA: tokenAAddress,
      tokenB: tokenBAddress,
      amountIn,
      minProfit: ethers.parseEther("1"),
    })
  ).wait();
  const balanceAfter = await tokenA.balanceOf(await trader.getAddress());
  const profit = balanceAfter - balanceBefore;
  assert.equal(profit, expectedOutput - amountIn);
  console.log(`✓ 一笔原子交易完成两次交换，利润：${ethers.formatEther(profit)} TKA`);

  const cheapPoolBefore = await cheapDex.getPool(0);
  const expensivePoolBefore = await expensiveDex.getPool(0);
  await (await tokenA.connect(trader).approve(await arbitrage.getAddress(), amountIn)).wait();
  try {
    await arbitrage.connect(trader).arbitrage({
      buyDex: cheapDexAddress,
      sellDex: expensiveDexAddress,
      buyPoolId: 0,
      sellPoolId: 0,
      tokenA: tokenAAddress,
      tokenB: tokenBAddress,
      amountIn,
      minProfit: ethers.MaxUint256,
    });
    assert.fail("An impossible minimum profit must revert");
  } catch (error) {
    assert.ok((error as Error).message.includes("Arbitrage not profitable"));
  }
  assert.equal(await tokenA.balanceOf(await trader.getAddress()), balanceAfter);
  const cheapPoolAfter = await cheapDex.getPool(0);
  const expensivePoolAfter = await expensiveDex.getPool(0);
  assert.equal(cheapPoolAfter.reserveA, cheapPoolBefore.reserveA);
  assert.equal(cheapPoolAfter.reserveB, cheapPoolBefore.reserveB);
  assert.equal(expensivePoolAfter.reserveA, expensivePoolBefore.reserveA);
  assert.equal(expensivePoolAfter.reserveB, expensivePoolBefore.reserveB);
  console.log("✓ 最低利润无法满足时整笔回滚，余额和两个池子均未改变");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
